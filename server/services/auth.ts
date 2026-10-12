import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { Config } from '../config.js';
import { settingsSchema, type Owner } from '../../shared/schemas.js';
import { assert, AppError } from '../errors.js';
import { constantEqual, hashPassword, randomToken, sha256, verifyPassword } from '../security.js';
export const accountInput = z.object({ setup_token: z.string().min(24).max(200), email: z.string().email().max(200), display_name: z.string().trim().min(1).max(80), password: z.string().min(12).max(200) }).strict();
export const loginInput = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }).strict();
export interface Session { owner: Owner; csrf: string; tokenHash: string; expiresAt: string }
export function publicOwner(row: Record<string, any>): Owner { return { id: row.id, email: row.email, display_name: row.display_name, phone_verified: row.phone_verified, has_phone_pin: !!row.phone_pin_hash }; }
export class Auth {
  constructor(private db: Database, private config: Config) {}
  async initialize(): Promise<void> {
    if (this.config.setupToken) await this.db.query("INSERT INTO system_meta(key,value) VALUES ('bootstrap', $1::jsonb) ON CONFLICT (key) DO NOTHING", [JSON.stringify({ hash: sha256(this.config.setupToken), consumed: false })]);
  }
  async status() {
    const owner = (await this.db.query('SELECT id FROM owners LIMIT 1')).rows[0];
    const bootstrap = (await this.db.query("SELECT value FROM system_meta WHERE key='bootstrap'")).rows[0]?.value;
    return { initialized: !!owner, setup_available: !owner && !!bootstrap && !bootstrap.consumed };
  }
  async setup(raw: unknown): Promise<Owner> {
    const input = accountInput.parse(raw);
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction(async tx => {
      const bootstrap = (await tx.query("SELECT value FROM system_meta WHERE key='bootstrap' FOR UPDATE")).rows[0]?.value;
      assert(bootstrap && !bootstrap.consumed && constantEqual(bootstrap.hash, sha256(input.setup_token)), 403, 'INVALID_SETUP_TOKEN', 'The one-time setup token is invalid or has already been used.');
      assert(!(await tx.query('SELECT id FROM owners LIMIT 1')).rows.length, 409, 'ALREADY_INITIALIZED', 'An owner account already exists.');
      const id = randomUUID();
      const row = (await tx.query('INSERT INTO owners(id,email,display_name,password_hash,settings) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *', [id, input.email.toLowerCase(), input.display_name, passwordHash, JSON.stringify(settingsSchema.parse({}))])).rows[0];
      await tx.query("UPDATE system_meta SET value=$1::jsonb, updated_at=now() WHERE key='bootstrap'", [JSON.stringify({ consumed: true })]);
      return publicOwner(row);
    });
  }
  async login(raw: unknown): Promise<{ owner: Owner; token: string; csrf: string }> {
    const input = loginInput.parse(raw);
    const row = (await this.db.query('SELECT * FROM owners WHERE email=$1', [input.email.toLowerCase()])).rows[0];
    // Equal-cost password derivation even for unknown accounts (avoids timing-based enumeration).
    const encoded = row?.password_hash || 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);
    const valid = await verifyPassword(input.password, encoded);
    assert(row && valid, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const token = randomToken(), csrf = randomToken();
    await this.db.transaction(async tx => {
      await tx.query("INSERT INTO sessions(token_hash,owner_id,csrf_token,expires_at) VALUES ($1,$2,$3,now() + interval '7 days')", [sha256(token), row.id, csrf]);
      await tx.query('DELETE FROM sessions WHERE expires_at < now()');
      await tx.query("INSERT INTO audit_logs(id,owner_id,action,entity_type) VALUES ($1,$2,'account.signed_in','account')", [randomUUID(), row.id]);
    });
    return { owner: publicOwner(row), token, csrf };
  }
  async session(token: string | undefined): Promise<Session | null> {
    if (!token || token.length > 200) return null;
    const row = (await this.db.query('SELECT o.*,s.csrf_token,s.expires_at FROM sessions s JOIN owners o ON o.id=s.owner_id WHERE s.token_hash=$1 AND s.expires_at>now()', [sha256(token)])).rows[0];
    return row ? { owner: publicOwner(row), csrf: row.csrf_token, tokenHash: sha256(token), expiresAt: new Date(row.expires_at).toISOString() } : null;
  }
  async logout(session: Session) { await this.db.query('DELETE FROM sessions WHERE token_hash=$1 AND owner_id=$2', [session.tokenHash, session.owner.id]); }
  async reauthenticate(ownerId: string, password: string) {
    const row = (await this.db.query('SELECT password_hash FROM owners WHERE id=$1', [ownerId])).rows[0];
    assert(row && await verifyPassword(password, row.password_hash), 401, 'REAUTH_REQUIRED', 'Confirm your current account password.');
  }
  async updatePassword(ownerId: string, current: string, next: string) {
    await this.reauthenticate(ownerId, current);
    z.string().min(12).max(200).parse(next);
    const hash = await hashPassword(next);
    await this.db.transaction(async tx => {
      await tx.query('UPDATE owners SET password_hash=$1 WHERE id=$2', [hash, ownerId]);
      await tx.query('DELETE FROM sessions WHERE owner_id=$1', [ownerId]);
    });
  }
  async setPhonePin(ownerId: string, password: string, pin: string) {
    await this.reauthenticate(ownerId, password);
    z.string().regex(/^\d{6,12}$/, 'Use 6–12 digits').refine(v => !/^(.)\1+$/.test(v) && !'01234567890123456789'.includes(v), 'Avoid repeated or sequential digits').parse(pin);
    const hash = await hashPassword(pin);
    await this.db.query('UPDATE owners SET phone_pin_hash=$1 WHERE id=$2', [hash, ownerId]);
  }
  async eraseAccount(ownerId: string, password: string, confirmation: string) {
    assert(confirmation === 'DELETE ALL PERSONAL DATA', 400, 'CONFIRMATION_REQUIRED', 'Type DELETE ALL PERSONAL DATA to confirm.');
    await this.reauthenticate(ownerId, password);
    await this.db.transaction(async tx => {
      const active = (await tx.query("SELECT id FROM calls WHERE owner_id=$1 AND status IN ('reserved','submitting','queued','ringing','in-progress') UNION ALL SELECT id FROM browser_voice_sessions WHERE owner_id=$1 AND status IN ('starting','active')", [ownerId])).rows;
      assert(!active.length, 409, 'ACTIVE_SESSION', 'End active or unresolved calls before deleting your account.');
      await tx.query('DELETE FROM owners WHERE id=$1', [ownerId]);
      await tx.query("DELETE FROM system_meta WHERE key <> 'bootstrap'");
      await tx.query("UPDATE system_meta SET value='{\"consumed\":true}'::jsonb,updated_at=now() WHERE key='bootstrap'");
    });
  }
}
