import Fastify,{type FastifyRequest} from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Database } from './db/database.js';
import type { Config } from './config.js';
import { Auth,type Session } from './services/auth.js';
import { Store } from './services/store.js';
import { Actions } from './services/actions.js';
import { Usage } from './services/usage.js';
import { updateSettings } from './services/preferences.js';
import { Scheduler } from './services/scheduler.js';
import { TwilioProvider,type TelephoneProvider } from './telephony/provider.js';
import { registerTelephony } from './telephony/webhooks.js';
import { registerMediaStream,type RealtimeFactory } from './telephony/stream.js';
import { OpenAIProvider,type ConversationProvider } from './ai/provider.js';
import { ConversationEngine } from './ai/conversation.js';
import { BrowserVoice } from './ai/browserVoice.js';
import { assert,AppError } from './errors.js';
import { checkOrigin,constantEqual } from './security.js';
import { uuid } from '../shared/schemas.js';
import { dayBounds } from './services/time.js';
declare module 'fastify' { interface FastifyRequest { ownerSession:Session|null } }
export interface AppOptions {db:Database;config:Config;phone?:TelephoneProvider;ai?:ConversationProvider;realtimeFactory?:RealtimeFactory;logger?:boolean}
export async function buildApp(options:AppOptions){
  const {db,config}=options;
  const app=Fastify({logger:options.logger===false?false:{level:'info',redact:['req.headers.cookie','req.headers.authorization','req.headers.x-twilio-signature','res.headers.set-cookie'],serializers:{req:(req:any)=>({method:req.method,url:req.url?.split('?')[0],id:req.id})}},trustProxy:config.trustProxy,bodyLimit:128000,requestTimeout:45000});
  app.decorateRequest('ownerSession',null);
  await app.register(cookie);await app.register(formbody);await app.register(rateLimit,{global:true,max:180,timeWindow:'1 minute',skipOnError:false});
  const auth=new Auth(db,config),store=new Store(db),actions=new Actions(db),usage=new Usage(db,config),phone=options.phone||new TwilioProvider(config),ai=options.ai||new OpenAIProvider(config);
  await auth.initialize();
  const engine=new ConversationEngine(db,config,ai),scheduler=new Scheduler(db,config,phone),browserVoice=new BrowserVoice(db,config,engine);
  const cookieName=config.nodeEnv==='production'?'__Host-krona':'krona_session';
  const cookieOptions=(request:FastifyRequest)=>({path:'/',httpOnly:true,secure:config.nodeEnv==='production'||config.dashboardOrigin.startsWith('https://')||request.headers.origin?.startsWith('https://')||false,sameSite:'strict' as const,maxAge:7*86400});
  app.addHook('onSend',async(request,reply,payload)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Permissions-Policy','camera=(), geolocation=(), microphone=(self)');
    reply.header('Content-Security-Policy',`default-src 'self'; script-src 'self'${config.nodeEnv!=='production'?" 'unsafe-inline'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${config.nodeEnv!=='production'?'ws: wss:':''}; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'${config.nodeEnv!=='production'?' https://arena.ai https://*.arena.ai https://*.e2b.app':''}`);
    if(request.url.startsWith('/api/')||request.url.startsWith('/twilio/'))reply.header('Cache-Control','no-store');
    if(config.nodeEnv==='production')reply.header('Strict-Transport-Security','max-age=31536000; includeSubDomains');return payload;
  });
  app.setErrorHandler((error:any,request,reply)=>{
    if(error instanceof z.ZodError)return reply.code(400).send({error:'VALIDATION_ERROR',message:'Check the highlighted input fields.',details:error.issues.map(i=>({field:i.path.join('.'),message:i.message}))});
    if(error instanceof AppError)return reply.code(error.status).send({error:error.code,message:error.message});
    if(error.statusCode===429)return reply.code(429).send({error:'RATE_LIMITED',message:'Too many requests. Wait a moment before trying again.'});
    if(error.code==='23505')return reply.code(409).send({error:'DUPLICATE_RECORD',message:'An equivalent record already exists. Review it before saving again.'});
    if(error.code==='23503')return reply.code(409).send({error:'INVALID_REFERENCE',message:'A related record no longer exists. Refresh and try again.'});
    if(error.statusCode&&error.statusCode<500)return reply.code(error.statusCode).send({error:'REQUEST_REJECTED',message:'The request was rejected.'});
    request.log.error({code:typeof error.code==='string'?error.code:'INTERNAL_ERROR',requestId:request.id},'Request failed; sensitive payload omitted');
    return reply.code(503).send({error:'SERVICE_UNAVAILABLE',message:'A required service is temporarily unavailable. Your existing data has not been replaced. Try again after checking System status.'});
  });
  const protectedRoute=async(request:FastifyRequest)=>{
    const session=await auth.session(request.cookies[cookieName]);assert(session,401,'AUTH_REQUIRED','Sign in to your private companion.');request.ownerSession=session;
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){checkOrigin(request,config);const csrf=request.headers['x-csrf-token'];assert(typeof csrf==='string'&&constantEqual(csrf,session.csrf),403,'CSRF_REQUIRED','Refresh your session before changing private data.');}
  };
  const owner=(r:FastifyRequest)=>r.ownerSession!.owner.id;
  const recordId=(r:FastifyRequest)=>z.object({id:uuid}).parse(r.params).id;
  app.get('/healthz',async()=>({ok:true,service:'krona',version:'1.0.0'}));
  app.get('/readyz',async(_r,reply)=>{try{await db.query('SELECT 1');return {ready:true};}catch{return reply.code(503).send({ready:false});}});
  app.get('/api/auth/status',async()=>auth.status());
  app.post('/api/auth/setup',{config:{rateLimit:{max:6,timeWindow:'15 minutes'}}},async(request,reply)=>{checkOrigin(request,config);const account=await auth.setup(request.body);const body=request.body as any,session=await auth.login({email:account.email,password:body.password});reply.setCookie(cookieName,session.token,cookieOptions(request));return {owner:session.owner,csrf:session.csrf};});
  app.post('/api/auth/login',{config:{rateLimit:{max:8,timeWindow:'15 minutes'}}},async(request,reply)=>{checkOrigin(request,config);const session=await auth.login(request.body);reply.setCookie(cookieName,session.token,cookieOptions(request));return {owner:session.owner,csrf:session.csrf};});
  app.get('/api/auth/me',{preHandler:protectedRoute},async r=>({owner:r.ownerSession!.owner,csrf:r.ownerSession!.csrf}));
  app.post('/api/auth/logout',{preHandler:protectedRoute},async(r,reply)=>{await auth.logout(r.ownerSession!);reply.clearCookie(cookieName,{path:'/'});return {signed_out:true};});
  app.post('/api/auth/password',{preHandler:protectedRoute,config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(r,reply)=>{const i=z.object({current_password:z.string().max(200),new_password:z.string().min(12).max(200)}).strict().parse(r.body);await auth.updatePassword(owner(r),i.current_password,i.new_password);reply.clearCookie(cookieName,{path:'/'});return {updated:true,signed_out:true};});
  app.post('/api/auth/phone-pin',{preHandler:protectedRoute,config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async r=>{const i=z.object({password:z.string().max(200),pin:z.string().min(6).max(12)}).strict().parse(r.body);await auth.setPhonePin(owner(r),i.password,i.pin);await store.audit(owner(r),'account.phone_pin_updated','account');return {saved:true};});
  app.get('/api/tasks',{preHandler:protectedRoute},async r=>{const q=z.object({q:z.string().max(240).optional(),status:z.string().max(30).optional(),project_id:uuid.optional(),limit:z.coerce.number().int().min(1).max(200).optional(),offset:z.coerce.number().int().min(0).max(1000000).optional()}).parse(r.query);return store.listTasks(owner(r),q);});
  app.get('/api/tasks/:id',{preHandler:protectedRoute},async r=>store.getTask(owner(r),recordId(r)));
  app.post('/api/tasks',{preHandler:protectedRoute},async(r,reply)=>reply.code(201).send(await store.createTask(owner(r),r.body)));
  app.patch('/api/tasks/:id',{preHandler:protectedRoute},async r=>store.updateTask(owner(r),recordId(r),r.body));
  app.delete('/api/tasks/:id',{preHandler:protectedRoute},async r=>{await store.deleteTask(owner(r),recordId(r));return {deleted:true};});
  app.get('/api/projects',{preHandler:protectedRoute},async r=>store.listProjects(owner(r)));
  app.post('/api/projects',{preHandler:protectedRoute},async(r,reply)=>reply.code(201).send(await store.createProject(owner(r),r.body)));
  app.patch('/api/projects/:id',{preHandler:protectedRoute},async r=>store.updateProject(owner(r),recordId(r),r.body));
  app.delete('/api/projects/:id',{preHandler:protectedRoute},async r=>{await store.deleteProject(owner(r),recordId(r));return {deleted:true};});
  app.get('/api/memories',{preHandler:protectedRoute},async r=>{const q=z.object({q:z.string().max(500).optional()}).parse(r.query);return store.listMemories(owner(r),q.q);});
  app.post('/api/memories',{preHandler:protectedRoute},async(r,reply)=>{const m=await store.createMemory(owner(r),r.body);void engine.retrieval.indexMemory(owner(r),m.id).catch(()=>{});return reply.code(201).send(m);});
  app.patch('/api/memories/:id',{preHandler:protectedRoute},async r=>{const m=await store.updateMemory(owner(r),recordId(r),r.body);void engine.retrieval.indexMemory(owner(r),m.id).catch(()=>{});return m;});
  app.delete('/api/memories/:id',{preHandler:protectedRoute},async r=>{await store.deleteMemory(owner(r),recordId(r));return {deleted:true};});
  app.get('/api/schedules',{preHandler:protectedRoute},async r=>store.listSchedules(owner(r)));
  app.post('/api/schedules',{preHandler:protectedRoute},async(r,reply)=>reply.code(201).send(await store.createSchedule(owner(r),r.body)));
  app.patch('/api/schedules/:id',{preHandler:protectedRoute},async r=>store.updateSchedule(owner(r),recordId(r),r.body));
  app.delete('/api/schedules/:id',{preHandler:protectedRoute},async r=>{await store.deleteSchedule(owner(r),recordId(r));return {deleted:true};});
  app.get('/api/jobs',{preHandler:protectedRoute},async r=>(await db.query('SELECT j.*,s.title FROM scheduled_jobs j JOIN schedules s ON s.id=j.schedule_id WHERE j.owner_id=$1 ORDER BY j.created_at DESC LIMIT 100',[owner(r)])).rows);
  app.get('/api/calls',{preHandler:protectedRoute},async r=>store.listCalls(owner(r)));
  app.post('/api/calls/:id/end',{preHandler:protectedRoute},async r=>{const call=await store.owned('calls',owner(r),recordId(r));assert(call.twilio_sid,409,'NO_PROVIDER_CALL','No confirmed provider call exists.');await phone.endCall(call.twilio_sid);await store.audit(owner(r),'call.end_requested','call',call.id);return {termination_requested:true};});
  app.post('/api/calls/:id/reconcile',{preHandler:protectedRoute,config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async r=>{const i=z.object({password:z.string().max(200),sid:z.string().max(100).optional(),confirm_not_placed:z.boolean().optional()}).strict().parse(r.body);await auth.reauthenticate(owner(r),i.password);return scheduler.reconcile(owner(r),recordId(r),i);});
  app.get('/api/conversations',{preHandler:protectedRoute},async r=>store.listConversations(owner(r)));
  app.get('/api/conversations/:id',{preHandler:protectedRoute},async r=>store.getConversation(owner(r),recordId(r)));
  app.post('/api/conversations/message',{preHandler:protectedRoute,config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async r=>engine.message(owner(r),r.body));
  app.post('/api/conversations/:id/end',{preHandler:protectedRoute},async r=>{await engine.end(owner(r),recordId(r));return {ended:true};});
  app.delete('/api/conversations/:id',{preHandler:protectedRoute},async r=>{const id=recordId(r);await store.deleteConversation(owner(r),id);engine.forget(owner(r),[id]);return {deleted:true};});
  app.get('/api/actions',{preHandler:protectedRoute},async r=>actions.list(owner(r)));
  app.post('/api/actions',{preHandler:protectedRoute},async(r,reply)=>reply.code(201).send(await actions.propose(owner(r),r.body)));
  app.post('/api/actions/:id/approve',{preHandler:protectedRoute,config:{rateLimit:{max:8,timeWindow:'15 minutes'}}},async r=>{const i=z.object({scope_hash:z.string().regex(/^[0-9a-f]{64}$/),password:z.string().max(200).optional(),authorization:z.literal('AUTHORIZE').optional()}).strict().parse(r.body);const a=await store.owned('actions',owner(r),recordId(r));if(a.risk==='high'){assert(i.password,403,'REAUTH_REQUIRED','Enter your account password to authorize this high-impact action.');await auth.reauthenticate(owner(r),i.password);}return actions.approve(owner(r),a.id,i.scope_hash,{channel:'dashboard',reauthenticated:!!i.password,explicitHighImpact:i.authorization==='AUTHORIZE'});});
  app.post('/api/actions/:id/reject',{preHandler:protectedRoute},async r=>actions.reject(owner(r),recordId(r)));
  app.post('/api/actions/:id/execute',{preHandler:protectedRoute},async r=>actions.execute(owner(r),recordId(r)));
  app.get('/api/settings',{preHandler:protectedRoute},async r=>({settings:await store.settings(owner(r)),owner:r.ownerSession!.owner,models:{text:config.textModel,realtime:config.realtimeModel},assistant_number:config.twilioPhoneNumber||null}));
  app.patch('/api/settings',{preHandler:protectedRoute},async r=>updateSettings(db,owner(r),r.body));
  app.get('/api/usage',{preHandler:protectedRoute},async r=>({daily:await usage.daily(owner(r)),limits:await store.settings(owner(r)),rates:{telephone_per_minute:config.twilioRate??null,ai_voice_per_minute:config.aiVoiceRate??null,ai_input_per_million:config.aiInputRate??null,ai_output_per_million:config.aiOutputRate??null},note:'Conservative operator-supplied estimates, not provider invoices or verified current pricing.'}));
  app.get('/api/status',{preHandler:protectedRoute},async()=>{
    let database:any;try{await db.query('SELECT 1');database={state:'healthy',detail:db.mode==='postgresql'?'PostgreSQL query succeeded.':'Disk-backed PostgreSQL is responding. Local single-process mode; not a cloud deployment.'};}catch{database={state:'degraded',detail:'Database query failed.'};}
    const meta=(await db.query("SELECT key,value FROM system_meta WHERE key IN ('scheduler','telephony_verified','ai_voice_verified')")).rows;
    const m=Object.fromEntries(meta.map(x=>[x.key,x.value])),beat=m.scheduler,age=beat?Date.now()-new Date(beat.at).getTime():Infinity;
    return {mode:config.nodeEnv,live_calling_enabled:config.liveCalls,live_ai_enabled:config.liveAI,database,
      ai:{state:!config.openaiApiKey?'unconfigured':!config.liveAI?'disabled':'configured',detail:!config.openaiApiKey?'OpenAI credentials are missing. No simulated conversation is used.':!config.liveAI?'Credentials present; ENABLE_LIVE_AI is off.':'Configured. Successful live requests must be tested separately.',last_verified_at:m.ai_voice_verified?.at||null},
      telephony:{state:!config.twilioAccountSid||!config.twilioAuthToken||!config.twilioPhoneNumber?'unconfigured':!config.liveCalls?'disabled':'configured',detail:!phone.available?'Twilio is unconfigured or live calling is disabled.':'Configured; only the verified owner number is supported. Third-party calling is disabled.',last_verified_at:m.telephony_verified?.at||null},
      scheduler:{state:!config.schedulerEnabled?'disabled':age>config.schedulerIntervalMs*3?'degraded':beat.state,detail:!config.schedulerEnabled?'The background worker is disabled.':age>config.schedulerIntervalMs*3?'No recent worker heartbeat. Start the backend worker.':'Persistent jobs are being checked by the backend.',last_verified_at:beat?.at||null}};
  });
  app.get('/api/overview',{preHandler:protectedRoute},async r=>{
    const id=owner(r),settings=await store.settings(id),bounds=dayBounds(new Date(),settings.timezone);
    const counts=(await db.query(`SELECT (SELECT count(*)::int FROM tasks WHERE owner_id=$1 AND status NOT IN ('completed','canceled')) AS open_tasks,
      (SELECT count(*)::int FROM tasks WHERE owner_id=$1 AND status='completed' AND completed_at>=$2 AND completed_at<$3) AS completed_today,
      (SELECT count(*)::int FROM projects WHERE owner_id=$1 AND status='active') AS active_projects,
      (SELECT count(*)::int FROM schedules WHERE owner_id=$1 AND enabled) AS scheduled_checkins,
      (SELECT count(*)::int FROM memories WHERE owner_id=$1) AS memories`,[id,bounds.start,bounds.end])).rows[0];
    return {counts,tasks:await store.listTasks(id,{limit:8}),projects:(await store.listProjects(id)).slice(0,6),schedules:(await store.listSchedules(id)).filter(s=>s.enabled).slice(0,5),activity:await store.activity(id,6),settings,usage:await usage.daily(id)};
  });
  app.get('/api/search',{preHandler:protectedRoute},async r=>{const {q}=z.object({q:z.string().trim().min(1).max(240)}).parse(r.query);const id=owner(r);return {tasks:await store.listTasks(id,{q,limit:20}),memories:await store.listMemories(id,q,20),projects:(await store.listProjects(id)).filter((p:any)=>(p.name+' '+p.description).toLowerCase().includes(q.toLowerCase())).slice(0,20)};});
  app.get('/api/data/export',{preHandler:protectedRoute},async(r,reply)=>reply.header('Content-Disposition','attachment; filename="krona-personal-data.json"').send(await store.exportData(owner(r))));
  app.post('/api/data/erase',{preHandler:protectedRoute,config:{rateLimit:{max:4,timeWindow:'15 minutes'}}},async(r,reply)=>{const i=z.object({password:z.string().max(200),confirmation:z.string().max(80)}).strict().parse(r.body);const id=owner(r),convos=await store.listConversations(id);await auth.eraseAccount(id,i.password,i.confirmation);engine.forget(id,convos.map((c:any)=>c.id));reply.clearCookie(cookieName,{path:'/'});return {deleted:true,backup_notice:'Application records are deleted. Managed database backups and provider records follow their independent retention policies; see the privacy documentation.'};});
  app.post('/api/voice/session',{preHandler:protectedRoute,config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async r=>{const {sdp}=z.object({sdp:z.string().min(10).max(65000)}).strict().parse(r.body);return browserVoice.start(owner(r),sdp);});
  app.post('/api/voice/session/:id/end',{preHandler:protectedRoute},async r=>browserVoice.end(owner(r),recordId(r)));
  registerTelephony(app,db,config,phone);registerMediaStream(app,db,config,phone,engine,options.realtimeFactory);
  if(existsSync(config.staticDir+'/index.html')){
    await app.register(staticPlugin,{root:config.staticDir,prefix:'/',wildcard:false});
    app.setNotFoundHandler((r,reply)=>{if(r.method==='GET'&&!r.url.startsWith('/api')&&!r.url.startsWith('/twilio')&&!r.url.startsWith('/voice'))return reply.sendFile('index.html');return reply.code(404).send({error:'NOT_FOUND',message:'Endpoint not found.'});});
  }else app.setNotFoundHandler((_r,reply)=>reply.code(404).send({error:'NOT_FOUND',message:'Run npm run build to serve the dashboard, or use the Vite dev server.'}));
  let retentionTimer:ReturnType<typeof setInterval>|null=null;
  app.addHook('onReady',async()=>{scheduler.start();if(config.nodeEnv!=='test'){retentionTimer=setInterval(()=>void store.retention().catch(()=>{}),3600000);retentionTimer.unref();await store.retention();}});
  app.addHook('onClose',async()=>{scheduler.stop();if(retentionTimer)clearInterval(retentionTimer);await browserVoice.stop();});
  return {app,auth,store,engine,scheduler,phone,ai,browserVoice};
}
