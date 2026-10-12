import WebSocket from 'ws';
import type { RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime';
import type { Config } from '../config.js';
import { AppError,assert } from '../errors.js';
import type { Settings } from '../../shared/schemas.js';
import { toolDefinitions } from './tools.js';
export interface RealtimeCallbacks {
  ready:()=>void; audio:(base64:string,itemId:string)=>void; speechStarted:()=>void;
  transcript:(role:'user'|'assistant',text:string)=>void;
  tool:(name:string,args:unknown,callId:string)=>Promise<unknown>;
  usage:(responseId:string,input:number,output:number,details:unknown)=>Promise<boolean>;
  failure:(code:string,transient:boolean)=>void;
}
export interface RealtimeConnection {
  connect():void; appendAudio(base64:string):void; interrupt(itemId:string|null,audioEndMs:number):void;
  say(instructions:string):void; close():void;
}
export function realtimeSession(config:Config,settings:Settings,instructions:string,transport:'phone'|'browser'):RealtimeSessionCreateRequest {
  return {
    type:'realtime',model:config.realtimeModel,instructions,output_modalities:['audio'],max_output_tokens:700,
    audio:{input:{...(transport==='phone'?{format:{type:'audio/pcmu' as const}}:{}),transcription:{model:'gpt-4o-mini-transcribe'},
      turn_detection:{type:'server_vad',threshold:0.5,prefix_padding_ms:300,silence_duration_ms:600,create_response:true,interrupt_response:transport==='browser'}},
      output:{...(transport==='phone'?{format:{type:'audio/pcmu' as const}}:{}),voice:settings.voice}},
    tools:toolDefinitions,tool_choice:'auto',tracing:null
  };
}
export class OpenAIRealtime implements RealtimeConnection {
  private socket:WebSocket|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private heartbeat:ReturnType<typeof setInterval>|null=null;
  private lastPong=Date.now();private closing=false;private ready=false;private responseActive=false;
  private pendingTools:Promise<void>=Promise.resolve();private toolsInResponse=0;private chain=0;private epoch=0;
  constructor(private config:Config,private session:RealtimeSessionCreateRequest,private callbacks:RealtimeCallbacks,private options:{callId?:string;socketFactory?:(url:string,options:any)=>WebSocket}={}){}
  connect(){
    assert(this.config.liveAI&&this.config.openaiApiKey,503,'AI_NOT_CONFIGURED','Real-time AI is disabled or not configured.');
    const url=this.options.callId?`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(this.options.callId)}`:`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.config.realtimeModel)}`;
    const make=this.options.socketFactory||((u,o)=>new WebSocket(u,o));
    this.socket=make(url,{headers:{Authorization:`Bearer ${this.config.openaiApiKey}`},maxPayload:1024*1024,handshakeTimeout:10000});
    this.timer=setTimeout(()=>this.fail('AI_SESSION_TIMEOUT',true),15000);this.timer.unref();
    this.socket.on('open',()=>{this.send({type:'session.update',session:this.session});this.lastPong=Date.now();this.heartbeat=setInterval(()=>{if(Date.now()-this.lastPong>45000){this.fail('AI_HEARTBEAT_TIMEOUT',true);return;}if(this.socket?.readyState===WebSocket.OPEN)this.socket.ping();},15000);this.heartbeat.unref();});
    this.socket.on('pong',()=>{this.lastPong=Date.now();});
    this.socket.on('message',data=>{let event:any;try{event=JSON.parse(data.toString());}catch{this.fail('AI_PROTOCOL_ERROR',false);return;}void this.handle(event).catch(()=>this.fail('AI_EVENT_PROCESSING_FAILED',false));});
    this.socket.on('error',()=>this.fail('AI_CONNECTION_ERROR',true));
    this.socket.on('close',(code)=>{if(!this.closing)this.fail('AI_CONNECTION_CLOSED',code===1006||code===1011);});
  }
  private send(event:unknown){if(this.socket?.readyState===WebSocket.OPEN){if(this.socket.bufferedAmount>256000){this.fail('AI_BACKPRESSURE_LIMIT',false);return;}this.socket.send(JSON.stringify(event));}}
  private async handle(event:any){
    switch(event.type){
      case 'session.updated':if(!this.ready){this.ready=true;if(this.timer)clearTimeout(this.timer);this.callbacks.ready();}break;
      case 'response.created':this.responseActive=true;this.toolsInResponse=0;break;
      case 'response.output_audio.delta':if(typeof event.delta==='string'&&typeof event.item_id==='string')this.callbacks.audio(event.delta,event.item_id);break;
      case 'input_audio_buffer.speech_started':this.epoch++;this.chain=0;this.callbacks.speechStarted();break;
      case 'conversation.item.input_audio_transcription.completed':if(typeof event.transcript==='string')this.callbacks.transcript('user',event.transcript);break;
      case 'response.output_audio_transcript.done':if(typeof event.transcript==='string')this.callbacks.transcript('assistant',event.transcript);break;
      case 'response.function_call_arguments.done':{
        this.toolsInResponse++;const name=event.name,args=event.arguments,callId=event.call_id;
        this.pendingTools=this.pendingTools.then(async()=>{
          let result:unknown;try{result=await this.callbacks.tool(name,JSON.parse(args),callId);}catch(e){result={ok:false,error:e instanceof AppError?e.code:'TOOL_FAILED',message:e instanceof AppError?e.message:'The operation failed and was not saved.'};}
          this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:callId,output:JSON.stringify(result)}});
        });break;
      }
      case 'response.done':{
        this.responseActive=false;const usage=event.response?.usage;
        if(usage){const allowed=await this.callbacks.usage(event.response.id,usage.input_tokens||0,usage.output_tokens||0,usage);if(!allowed){this.fail('AI_USAGE_LIMIT_REACHED',false);return;}}
        const tools=this.toolsInResponse,epoch=this.epoch;await this.pendingTools;
        if(tools&&epoch===this.epoch&&!this.responseActive&&!this.closing){if(++this.chain>6){this.fail('TOOL_CHAIN_LIMIT_REACHED',false);return;}this.send({type:'response.create'});}break;
      }
      case 'error':{
        const code=event.error?.code;
        if(['response_cancel_not_active','conversation_already_has_active_response'].includes(code))return;
        this.fail(typeof code==='string'?code:'AI_PROVIDER_ERROR',false);break;
      }
    }
  }
  appendAudio(base64:string){if(this.ready)this.send({type:'input_audio_buffer.append',audio:base64});}
  interrupt(itemId:string|null,audioEndMs:number){if(this.responseActive)this.send({type:'response.cancel'});this.responseActive=false;if(itemId)this.send({type:'conversation.item.truncate',item_id:itemId,content_index:0,audio_end_ms:Math.max(0,Math.floor(audioEndMs))});}
  say(instructions:string){this.send({type:'response.create',response:{instructions}});}
  private fail(code:string,transient:boolean){if(this.closing)return;this.callbacks.failure(code,transient);this.close();}
  close(){this.closing=true;if(this.timer)clearTimeout(this.timer);if(this.heartbeat)clearInterval(this.heartbeat);this.socket?.close();}
}
