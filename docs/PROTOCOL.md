# PROTOCOL (v0)

- Transporte: WebSocket binário (M0–M3) → WebTransport com fallback WS (M4+). Handshake envia `PROTOCOL_VERSION`; mismatch = desconectar com erro claro.
- Todo pacote: `[u8 type][u16 length][payload]`. Tipos em `packages/shared/net/messages.ts` (fonte única).

## Client → Server
| Tipo | Campos |
|---|---|
| Hello | token, protocolVersion, clientBuild |
| Input | seq(u32), tick(u32), moveX(i8), moveY(i8), yaw(u16), buttons(u16 bitmask: attack, dodge, guard, grab, jump, interact), skillId(u16), targetId(u32?) |
| Chat | channel(u8), text(utf8 ≤200) |
| Ping | clientTime(u32) |
| Action (REST/ws confiável) | equip, use item, party, trade, shop... |

## Server → Client
| Tipo | Campos |
|---|---|
| Welcome | playerId, zoneId, serverTick, tickRate, snapshot completo |
| Snapshot (delta) | serverTick, ackSeq, entidades[ id(varint), mask, pos quantizada (16 bits/eixo, 1/64 m), yaw(u8), animState(u8), hp% (u8) ] |
| Event | eventId, type (Hit, Death, SkillStart, Buff, Loot, Spawn, Despawn), payload |
| Pong | clientTime, serverTime |
| Reject | seq, reason (cooldown, mana, range, state) |

## Regras
- Snapshots só incluem o que mudou (bitmask) e só entidades no interest set.
- Quantização de posição/ângulo; compressão por delta contra último ack do client.
- Reconexão: token de sessão 60 s para retomar a mesma posição.
- Teste obrigatório com latência simulada (50/100/200 ms, jitter 20 ms, 2% perda).
