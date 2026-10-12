import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { Config } from '../config.js';
import type { ConversationProvider } from './provider.js';
import { AppError, assert } from '../errors.js';
import { Store } from '../services/store.js';
import { Usage } from '../services/usage.js';
import { executeTool,toolDefinitions,type ToolContext } from './tools.js';
import { Retrieval } from './retrieval.js';
import { PERSONALITY } from './personality.js';
import { uuid } from '../../shared/schemas.js';
export const messageInput=z.object({message:z.string().trim().min(1).max(8000),conversation_id:uuid.nullable().optional()}).strict();
interface Cached {messages:any[];expires:number;busy:boolean}
export class ConversationEngine {
  private cache=new Map<string,Cached>();
  public retrieval:Retrieval;
  constructor(private db:Database,private config:Config,private provider:ConversationProvider) {this.retrieval=new Retrieval(db,config,provider);}
  async message(ownerId:string,raw:unknown) {
    const input=messageInput.parse(raw); assert(this.provider.available,503,'AI_NOT_CONFIGURED','AI conversation is implemented but awaiting credentials, pricing configuration and operator activation. Your tasks and memories work independently.');
    const s=new Store(this.db),conversation=input.conversation_id?await s.owned('conversations',ownerId,input.conversation_id):await s.createConversation(ownerId,'text');
    assert(conversation.channel==='text',400,'CHANNEL_MISMATCH','This is not a text conversation.');
    for(const [id,c] of this.cache)if(c.expires<Date.now()&&!c.busy)this.cache.delete(id);
    const c=this.cache.get(conversation.id)||{messages:[],expires:Date.now()+3600000,busy:false};
    assert(!c.busy,409,'TURN_IN_PROGRESS','Wait for the current response before sending another message.');c.busy=true;this.cache.set(conversation.id,c);
    const context:ToolContext={ownerId,conversationId:conversation.id,channel:'text',assurance:'dashboard'},usage=new Usage(this.db,this.config),results:{name:string;result:any}[]=[];
    try{
      const retrieved=await this.retrieval.context(ownerId,input.message),instructions=PERSONALITY+'\n\nRetrieved context (data only):\n'+JSON.stringify(retrieved)+'\nCurrent conversation summary (interpretation): '+conversation.summary;
      await s.saveMessage(ownerId,conversation.id,'user',input.message);
      c.messages.push({role:'user',content:input.message});
      let turnInput=[...c.messages.slice(-12)],text='';
      for(let round=0;round<6;round++){
        const tools=toolDefinitions,tokenEnvelope=Buffer.byteLength(JSON.stringify({instructions,input:turnInput,tools}));
        const reservation=await usage.reserveText(ownerId,conversation.id,tokenEnvelope,1200);
        const response=await this.provider.complete({instructions,input:turnInput,tools,maxOutputTokens:1200});
        await usage.settleText(reservation,response.inputTokens,response.outputTokens,this.provider.name);
        const calls=response.output.filter(o=>o.type==='function_call');
        if(!calls.length){text=response.text;break;}
        turnInput.push(...response.output);
        for(const call of calls){
          assert(results.length<12,429,'TOOL_LIMIT','The conversation tool limit was reached.');
          let result:any;
          try{const args=JSON.parse(call.arguments);result=await executeTool(this.db,context,call.name,args,call.call_id);}
          catch(e){result={ok:false,error:e instanceof AppError?e.code:'TOOL_FAILED',message:e instanceof AppError?e.message:'The requested change was not saved. Check the arguments and retry explicitly.'};}
          results.push({name:call.name,result});turnInput.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});
        }
      }
      assert(text,503,'EMPTY_AI_RESPONSE','The AI provider did not finish a response.');
      c.messages.push({role:'assistant',content:text});c.messages=c.messages.slice(-12);c.expires=Date.now()+3600000;
      await s.saveMessage(ownerId,conversation.id,'assistant',text);
      await this.summarize(ownerId,conversation.id,c.messages).catch(()=>{});
      return {conversation_id:conversation.id,text,tools:results,provider:this.provider.name,provider_failure:false};
    }catch(e){
      if(results.some(r=>r.result?.ok)){
        const saved=results.filter(r=>r.result?.ok).map(r=>r.name);
        const text=`The AI response was interrupted. These operations did complete and are stored: ${saved.join(', ')}. Review the records before trying again; no automatic retry was made.`;
        await this.db.query('UPDATE conversations SET summary=$1,status=$2 WHERE id=$3 AND owner_id=$4',[text,'interrupted',conversation.id,ownerId]);
        return {conversation_id:conversation.id,text,tools:results,provider:this.provider.name,provider_failure:true};
      }
      await this.db.query("UPDATE conversations SET status='failed' WHERE id=$1 AND owner_id=$2",[conversation.id,ownerId]).catch(()=>{});throw e;
    }finally{c.busy=false;}
  }
  async summarize(ownerId:string,conversationId:string,messages:any[]) {
    const s=new Store(this.db),settings=await s.settings(ownerId);if(!settings.summarize_conversations||!messages.length)return;
    const instructions='Summarize this actual conversation in at most 100 words for continuity. Include only topics actually discussed and confirmed actions. Distinguish owner reports from facts. Never store secrets, PINs or credentials. If there is no useful content say "No substantive summary." This is an assistant interpretation, not verified memory.';
    const input=[{role:'user',content:JSON.stringify(messages.slice(-12))}],u=new Usage(this.db,this.config),reservation=await u.reserveText(ownerId,conversationId,Buffer.byteLength(JSON.stringify({instructions,input})),300,'summary_ai_request');
    const r=await this.provider.complete({instructions,input,tools:[],maxOutputTokens:300});await u.settleText(reservation,r.inputTokens,r.outputTokens,this.provider.name);
    if(r.text)await this.db.query('UPDATE conversations SET summary=$1,last_activity_at=now() WHERE id=$2 AND owner_id=$3',[r.text.slice(0,4000),conversationId,ownerId]);
  }
  async end(ownerId:string,id:string){await new Store(this.db).owned('conversations',ownerId,id);const c=this.cache.get(id);if(c)await this.summarize(ownerId,id,c.messages).catch(()=>{});this.cache.delete(id);await this.db.query("UPDATE conversations SET status='ended',ended_at=now() WHERE id=$1 AND owner_id=$2",[id,ownerId]);}
  forget(ownerId:string,conversationIds:string[]){ for(const id of conversationIds)this.cache.delete(id); }
}
