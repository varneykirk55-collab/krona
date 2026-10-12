import twilio from 'twilio';
import type { Config } from '../config.js';
import { AppError, assert } from '../errors.js';
export interface PlacedCall {sid:string;status:string}
export interface TelephoneProvider {
  name:string;available:boolean;
  placeOwnerCall(input:{phone:string;intentId:string;maxSeconds:number}):Promise<PlacedCall>;
  endCall(sid:string):Promise<void>;
  replaceWithMessage(sid:string,message:string):Promise<void>;
  lookupCall(sid:string):Promise<{sid:string;status:string;to:string;from:string;duration:number|null}>;
}
export class TwilioProvider implements TelephoneProvider {
  name='twilio';private client:ReturnType<typeof twilio>|null;
  constructor(private config:Config){this.client=config.twilioAccountSid&&config.twilioAuthToken?twilio(config.twilioAccountSid,config.twilioAuthToken,{autoRetry:false,timeout:15000,keepAlive:true}):null;}
  get available(){return !!this.client&&!!this.config.twilioPhoneNumber&&this.config.liveCalls;}
  async placeOwnerCall(input:{phone:string;intentId:string;maxSeconds:number}) {
    assert(this.available,503,'TELEPHONY_NOT_CONFIGURED','Telephone calls are implemented but disabled or awaiting configuration.');
    const call=await this.client!.calls.create({to:input.phone,from:this.config.twilioPhoneNumber!,url:`${this.config.publicBaseUrl}/twilio/answer?intent=${input.intentId}`,method:'POST',statusCallback:`${this.config.publicBaseUrl}/twilio/status?intent=${input.intentId}`,statusCallbackMethod:'POST',statusCallbackEvent:['initiated','ringing','answered','completed'],timeLimit:input.maxSeconds,timeout:25,record:false});
    return {sid:call.sid,status:call.status};
  }
  async endCall(sid:string){assert(this.available,503,'TELEPHONY_NOT_CONFIGURED','Telephony is disabled.');await this.client!.calls(sid).update({status:'completed'});}
  async replaceWithMessage(sid:string,message:string){assert(this.available,503,'TELEPHONY_NOT_CONFIGURED','Telephony is disabled.');const response=new twilio.twiml.VoiceResponse();response.say(message);response.hangup();await this.client!.calls(sid).update({twiml:response.toString()});}
  async lookupCall(sid:string){assert(this.available,503,'TELEPHONY_NOT_CONFIGURED','Telephony is disabled.');const call=await this.client!.calls(sid).fetch();return {sid:call.sid,status:call.status,to:call.to,from:call.from,duration:call.duration?Number(call.duration):null};}
}
export function isDefinitiveRejection(error:unknown):boolean { const status=(error as any)?.status;return typeof status==='number'&&status>=400&&status<500; }
