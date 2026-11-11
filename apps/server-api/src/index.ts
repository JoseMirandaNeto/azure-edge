/**
 * server-api — M0 stub. Account / auth / persistence abstraction.
 *
 * Decision (ADR-001): Supabase Free is the M0–M2 prototype backend. NO real
 * credentials live in this repo: only the interface + .env.example. The game
 * traffic (ticks/snapshots) NEVER goes through Supabase — only account,
 * auth and character persistence do, via this interface.
 *
 * To plug Supabase in later (M4): implement `SupabasePersistence` against
 * @supabase/supabase-js using SUPABASE_URL / SUPABASE_ANON_KEY from the
 * environment, and swap the export in this file. Nothing else changes.
 */

export interface Account {
  id: string;
  email: string;
  displayName: string;
}

export interface CharacterRecord {
  id: string;
  accountId: string;
  name: string;
  /** Serialised CharForge genome (<= 1 KB JSON). */
  genomeJson: string;
  level: number;
  zoneId: string;
}

export interface Persistence {
  getAccount(id: string): Promise<Account | null>;
  listCharacters(accountId: string): Promise<CharacterRecord[]>;
  saveCharacter(c: CharacterRecord): Promise<void>;
}

/** In-memory implementation for local M0 dev only — data is lost on restart. */
export class InMemoryPersistence implements Persistence {
  private readonly accounts = new Map<string, Account>();
  private readonly characters = new Map<string, CharacterRecord>();

  async getAccount(id: string): Promise<Account | null> {
    return this.accounts.get(id) ?? null;
  }
  async listCharacters(accountId: string): Promise<CharacterRecord[]> {
    return [...this.characters.values()].filter((c) => c.accountId === accountId);
  }
  async saveCharacter(c: CharacterRecord): Promise<void> {
    this.characters.set(c.id, c);
  }
  seedDemo(): void {
    this.accounts.set("demo", { id: "demo", email: "demo@example.com", displayName: "Demo" });
  }
}

export const persistence: Persistence = new InMemoryPersistence();
