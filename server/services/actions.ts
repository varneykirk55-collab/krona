import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import { assert, AppError } from '../errors.js';
import { sha256 } from '../security.js';
import { Store } from './store.js';
import { phoneNumber, isoDate, timezone, memoryCategory } from '../../shared/schemas.js';
export type Risk = 'low' | 'confirmation' | 'high';
const kinds = {
  'note.create': {risk:'low' as Risk,schema:z.object({content:z.string().min(1).max(6000),category:memoryCategory.default('knowledge')}).strict()},
  'third_party.call': {risk:'confirmation' as Risk,schema:z.object({phone_number:phoneNumber,goal:z.string().min(1).max(2000),details:z.string().max(4000),ai_disclosure:z.literal(true)}).strict()},
  'message.send': {risk:'confirmation' as Risk,schema:z.object({recipient:z.string().min(1).max(240),body:z.string().min(1).max(6000)}).strict()},
  'calendar.create': {risk:'confirmation' as Risk,schema:z.object({title:z.string().min(1).max(240),starts_at:isoDate,ends_at:isoDate,timezone,details:z.string().max(2000)}).strict()},
  'money.spend': {risk:'high' as Risk,schema:z.object({payee:z.string().min(1).max(240),amount:z.number().positive().max(1000000),currency:z.string().regex(/^[A-Z]{3}$/),purpose:z.string().min(1).max(2000)}).strict()},
  'agreement.accept': {risk:'high' as Risk,schema:z.object({counterparty:z.string().min(1).max(240),terms:z.string().min(1).max(10000)}).strict()},
  'private.share': {risk:'high' as Risk,schema:z.object({recipient:z.string().min(1).max(240),information:z.string().min(1).max(6000),purpose:z.string().min(1).max(2000)}).strict()}
};
export const actionProposal = z.object({kind:z.enum(Object.keys(kinds) as [keyof typeof kinds,...(keyof typeof kinds)[]]),title:z.string().trim().min(1).max(240),payload:z.record(z.string(),z.unknown())}).strict();
export function canonical(value: unknown): string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as any)[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const scopeHash = (kind: string,payload: unknown) => sha256(canonical({kind,payload}));
export function actionRisk(kind: string): Risk { assert(kind in kinds,400,'UNKNOWN_ACTION','This action type is not supported.'); return kinds[kind as keyof typeof kinds].risk; }
export class Actions {
  constructor(private db:Database){}
  async propose(ownerId:string,raw:unknown) {
    const input=actionProposal.parse(raw),definition=kinds[input.kind],payload=definition.schema.parse(input.payload);
    const expires=new Date(Date.now()+(definition.risk==='high'?30*60000:24*3600000)).toISOString();
    return this.db.transaction(async tx=>{
      const s=new Store(tx),action=(await tx.query('INSERT INTO actions(id,owner_id,kind,risk,title,payload,scope_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *',[randomUUID(),ownerId,input.kind,definition.risk,input.title,JSON.stringify(payload),scopeHash(input.kind,payload),expires])).rows[0];
      await s.audit(ownerId,'action.proposed','action',action.id,{kind:input.kind,risk:definition.risk}); return action;
    });
  }
  async list(ownerId:string) { return (await this.db.query('SELECT * FROM actions WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[ownerId])).rows; }
  async approve(ownerId:string,id:string,requestedHash:string,context:{channel:'dashboard'|'phone';reauthenticated:boolean;explicitHighImpact:boolean}) {
    return this.db.transaction(async tx=>{
      const s=new Store(tx),action=await s.owned('actions',ownerId,id,true);
      assert(context.channel==='dashboard',403,'DASHBOARD_APPROVAL_REQUIRED','Approve external actions in your authenticated dashboard.');
      assert(action.status==='proposed',409,'INVALID_ACTION_STATE','This action is no longer awaiting approval.');
      assert(new Date(action.expires_at).getTime()>Date.now(),409,'APPROVAL_EXPIRED','This proposal expired. Create and review a new one.');
      assert(requestedHash===action.scope_hash&&action.scope_hash===scopeHash(action.kind,action.payload),409,'SCOPE_CHANGED','The proposed scope has changed. Review it again.');
      if(action.risk==='high') assert(context.reauthenticated&&context.explicitHighImpact,403,'EXPLICIT_AUTHORIZATION_REQUIRED','High-impact actions require password reauthentication and explicit authorization of this exact scope.');
      const result=await s.update('actions',ownerId,id,{status:'approved',approved_scope_hash:action.scope_hash,approved_at:new Date().toISOString()});
      await s.audit(ownerId,'action.approved','action',id,{risk:action.risk}); return result;
    });
  }
  async reject(ownerId:string,id:string) { return this.db.transaction(async tx=>{const s=new Store(tx),a=await s.owned('actions',ownerId,id,true); assert(['proposed','approved'].includes(a.status),409,'INVALID_ACTION_STATE','This action cannot be withdrawn.'); await s.audit(ownerId,'action.rejected','action',id); return s.update('actions',ownerId,id,{status:'rejected'});}); }
  async execute(ownerId:string,id:string) {
    return this.db.transaction(async tx=>{
      const s=new Store(tx),a=await s.owned('actions',ownerId,id,true);
      if(a.status==='completed') return a; // Idempotent internal executor result.
      assert(new Date(a.expires_at).getTime()>Date.now(),409,'APPROVAL_EXPIRED','This authorization expired.');
      assert(a.scope_hash===scopeHash(a.kind,a.payload),409,'SCOPE_CHANGED','This action was changed after review.');
      if(a.risk!=='low') assert(a.status==='approved'&&a.approved_scope_hash===a.scope_hash,403,'APPROVAL_REQUIRED','Explicit approval is required for this exact action.');
      // No generic HTTP executor, third-party dialer, spending or booking integration exists.
      // Add allowlisted, idempotent, legally reviewed executors here; never trust model-provided risk.
      if(a.kind!=='note.create') throw new AppError(501,'EXECUTOR_NOT_CONFIGURED','The authorization is saved, but this external integration is disabled and has no configured executor. Nothing has been sent, booked, called or spent.');
      assert(['proposed','approved'].includes(a.status),409,'INVALID_ACTION_STATE','This action cannot execute.');
      const memory=await s.createMemory(ownerId,{...a.payload,source:'authorized internal action'});
      const result=await s.update('actions',ownerId,id,{status:'completed',result:JSON.stringify({memory_id:memory.id})});
      await s.audit(ownerId,'action.completed','action',id,{kind:a.kind}); return result;
    });
  }
}
