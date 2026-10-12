import type { Database } from '../db/database.js';
import type { Config } from '../config.js';
import type { ConversationProvider } from './provider.js';
import { Store } from '../services/store.js';
import { Usage } from '../services/usage.js';
export function cosine(a:number[],b:number[]):number { if(a.length!==b.length||!a.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0; }
export class Retrieval {
  constructor(private db:Database,private config:Config,private provider:ConversationProvider){}
  async context(ownerId:string,query:string) {
    const s=new Store(this.db),settings=await s.settings(ownerId);
    const memories=await s.retrieveMemory(ownerId,query,true,12);
    const projects=(await s.listProjects(ownerId)).filter((p:any)=>p.status!=='archived').slice(0,8).map((p:any)=>({id:p.id,name:p.name,status:p.status,progress:p.progress,objectives:p.objectives,milestones:p.milestones,blockers:p.blockers,decisions:p.decisions.slice(-5),next_action:p.next_action,updated_at:p.updated_at}));
    const tasks=await s.listTasks(ownerId,{q:query,limit:12});
    const recentTasks=(await s.listTasks(ownerId,{limit:16})).map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,due_at:t.due_at,project_id:t.project_id,updated_at:t.updated_at}));
    const conversations=(await s.listConversations(ownerId)).filter((c:any)=>c.summary).slice(0,4).map((c:any)=>({summary:c.summary,confidence:c.summary_confidence,started_at:c.started_at}));
    // Optional genuine provider embeddings; bounded candidate scan, not a claimed semantic mock.
    let semantic:any[]=[];
    if(this.config.semanticSearch&&this.provider.available&&this.provider.embed&&query.trim()){
      try{
        const usage=new Usage(this.db,this.config),reservation=await usage.reserveText(ownerId,null,Buffer.byteLength(query),1,'embedding_ai_request');
        const embedded=await this.provider.embed(query.slice(0,1000));await usage.settleText(reservation,embedded.tokens,0,this.provider.name);
        const candidates=(await this.db.query("SELECT id,content,confidence,category,embedding FROM memories WHERE owner_id=$1 AND embedding IS NOT NULL AND embedding_model=$2 AND confidence<>'outdated' AND NOT(category=ANY($3::text[])) ORDER BY updated_at DESC LIMIT 500",[ownerId,this.config.embeddingModel,settings.disabled_memory_categories])).rows;
        semantic=candidates.map(m=>({id:m.id,content:m.content,confidence:m.confidence,category:m.category,score:cosine(embedded.vector,m.embedding)})).filter(m=>m.score>0.3).sort((a,b)=>b.score-a.score).slice(0,8);
      }catch{ /* Structured/full-text retrieval remains functional; failed reservations remain conservative. */ }
    }
    return {current_time:new Date().toISOString(),timezone:settings.timezone,communication_style:settings.communication_style,memories,semantic_memories:semantic,projects,relevant_tasks:tasks,current_tasks:recentTasks,previous_conversation_summaries:conversations,outbound_enabled:settings.outbound_enabled,paused_until:settings.paused_until};
  }
  async indexMemory(ownerId:string,id:string) {
    if(!this.config.semanticSearch||!this.provider.available||!this.provider.embed)return;
    const s=new Store(this.db),m=await s.owned('memories',ownerId,id),settings=await s.settings(ownerId);
    if(settings.disabled_memory_categories.includes(m.category)||m.sensitive)return;
    const usage=new Usage(this.db,this.config),reservation=await usage.reserveText(ownerId,null,Buffer.byteLength(m.content),1,'embedding_ai_request');
    const e=await this.provider.embed(m.content);await usage.settleText(reservation,e.tokens,0,this.provider.name);
    await this.db.query('UPDATE memories SET embedding=$1::double precision[],embedding_model=$2 WHERE id=$3 AND owner_id=$4 AND content=$5',[e.vector,this.config.embeddingModel,id,ownerId,m.content]);
  }
}
