import type { Database } from '../db/database.js';
import { settingsPatch,settingsSchema } from '../../shared/schemas.js';
import { Store } from './store.js';
import { assert } from '../errors.js';
export async function updateSettings(db:Database,ownerId:string,raw:unknown){
  const parsed=settingsPatch.parse(raw),{consent_to_outbound,...patch}=parsed;
  return db.transaction(async tx=>{
    const owner=(await tx.query('SELECT * FROM owners WHERE id=$1 FOR UPDATE',[ownerId])).rows[0];assert(owner,404,'NOT_FOUND','Owner account not found.');
    const old=settingsSchema.parse(owner.settings),settings=settingsSchema.parse({...old,...patch});
    let consent=owner.outbound_consent_at,verified=owner.phone_verified;
    if(patch.phone_number!==undefined&&patch.phone_number!==old.phone_number){
      const active=(await tx.query("SELECT id FROM calls WHERE owner_id=$1 AND status IN ('reserved','submitting','queued','ringing','in-progress','unknown')",[ownerId])).rows;
      assert(!active.length,409,'ACTIVE_CALL','End or reconcile calls before changing your phone number.');
      verified=false;settings.outbound_enabled=false;consent=null;
    }
    if(settings.outbound_enabled&&!old.outbound_enabled){
      assert(consent_to_outbound===true,403,'OUTBOUND_CONSENT_REQUIRED','Explicitly consent to receiving automated AI calls at your verified owner number.');
      assert(verified&&owner.phone_pin_hash&&settings.phone_number,409,'PHONE_VERIFICATION_REQUIRED','Set a phone PIN, save your number and authenticate an incoming call before enabling outgoing calls.');
      consent=new Date().toISOString();
    }
    if(!settings.outbound_enabled)consent=null;
    await tx.query('UPDATE owners SET settings=$1::jsonb,phone_verified=$2,outbound_consent_at=$3 WHERE id=$4',[JSON.stringify(settings),verified,consent,ownerId]);
    if(patch.retain_transcripts===false){await tx.query('DELETE FROM conversation_messages WHERE owner_id=$1',[ownerId]);}
    await new Store(tx).audit(ownerId,'settings.updated','settings',null,{fields:Object.keys(patch)});
    return settings;
  });
}
