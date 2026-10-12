import {describe,expect,it} from 'vitest';
import {TwilioPlayback} from '../server/telephony/playback.js';
import {realtimeSession} from '../server/ai/realtime.js';
import {settingsSchema} from '../shared/schemas.js';
import {loadConfig} from '../server/config.js';
describe('Audio protocol and interruption unit tests (not live telephone tests)',()=>{
  it('passes raw 8 kHz μ-law bytes and chunks to <=200 ms',()=>{const events:any[]=[],p=new TwilioPlayback('MZtest',e=>events.push(e));p.audio(Buffer.alloc(3200,42).toString('base64'),'item_1');const media=events.filter(e=>e.event==='media');expect(media).toHaveLength(2);expect(Buffer.concat(media.map(e=>Buffer.from(e.media.payload,'base64')))).toEqual(Buffer.alloc(3200,42));expect(events.at(-1).event).toBe('mark');});
  it('truncates to played time and clears discarded marks on interruption',()=>{const events:any[]=[],p=new TwilioPlayback('MZtest',e=>events.push(e));p.timestamp(1000);p.audio(Buffer.alloc(8000).toString('base64'),'assistant_1');const oldMark=events.at(-1).mark.name;p.timestamp(1250);const i=p.interrupt();expect(i.itemId).toBe('assistant_1');expect(i.audioEndMs).toBe(250);expect(events.at(-1).event).toBe('clear');p.acknowledge(oldMark);p.audio(Buffer.alloc(800).toString('base64'),'assistant_2');p.timestamp(1300);expect(p.interrupt().audioEndMs).toBe(50);});
  it('uses the GA native μ-law format, not obsolete beta configuration',()=>{const c=loadConfig({NODE_ENV:'test',DATA_DIR:'/home/user/krona/.data/unit-config',SESSION_SECRET:'test-session-secret-'.repeat(3),SETUP_TOKEN:'test-setup-token-'.repeat(3)});const s=realtimeSession(c,settingsSchema.parse({}),'Test instructions','phone');expect(s.audio?.input?.format).toEqual({type:'audio/pcmu'});expect(s.audio?.output?.format).toEqual({type:'audio/pcmu'});expect(s.output_modalities).toEqual(['audio']);expect((s.audio?.input?.turn_detection as any).interrupt_response).toBe(false);});
});
