---
name: market-rules
description: Buy/sell/swap algorithms, validation rules, and the test-case table for SuperLega market operations. Load when implementing or testing market functions.
---

# Market rules — algorithms and test cases

## swap_player(team, player_out, player_in) — pseudocode

```
lock teams row FOR UPDATE
assert caller owns team (or is admin acting for it)
assert session exists and status = 'open' and now() within window
assert player_out currently in team roster (released_at is null)
assert player_in in session_free_agents(session) and players.status = 'active'
assert role_classic(player_in) == role_classic(player_out)
assert team.swaps_used < season_swap_limit (20)
refund  = players.qt_a of player_out   -- current quotation
cost    = players.qt_a of player_in
assert team.credits + refund - cost >= 0
close roster row (out), insert roster row (in, price_paid = cost)
team.credits += refund - cost ; team.swaps_used += 1
insert transactions (kind, out, refund, in, cost, counts_toward_limit = true)
insert audit_log
```

## free_swap_player(team, player_out, player_in)

Same, except: no session required; `player_out.status = 'out_of_list'`;
`player_in` must be a free agent **now** (no team owns it) and active;
`refund = roster.price_paid` of player_out; `counts_toward_limit = false`;
`swaps_used` unchanged.

## open_market_session / close_market_session

Open (admin): scheduled→open, snapshot free agents (active players with no
open roster row), credit +extra_budget (5) to every team exactly once, email.
Close (admin): open→closed, validate every roster (23, 3/7/7/6, credits >= 0),
store validation_report, email summary.

## reverse_transaction(tx, reason) — admin only

Creates the inverse rows (reopen/annul roster rows, refund/charge credits,
decrement swaps_used if it counted), links `reversal_of`, requires a reason.
Never deletes anything. A reversal cannot itself be reversed twice.

## Tabella dei casi di test (minimo)

| # | Caso | Esito atteso |
|---|------|--------------|
| 1 | Cambio valido in sessione aperta | ok; crediti e swaps_used aggiornati |
| 2 | Sessione chiusa/programmata | errore "sessione non aperta" |
| 3 | player_in non nella foto svincolati | errore |
| 4 | player_in preso da altri NELLA STESSA sessione | **ok** (non esclusivo) |
| 5 | Ruoli diversi out/in | errore |
| 6 | Crediti insufficienti (refund−cost porta sotto 0) | errore, nulla scritto |
| 7 | 20° cambio | ok; 21° | errore limite |
| 8 | Due cambi simultanei stessa squadra (concorrenza) | mai crediti<0 né >20 |
| 9 | Free swap con out non fuori-lista | errore |
| 10 | Free swap a sessione chiusa | ok, non conta nei 20, rimborso=prezzo pagato |
| 11 | Free swap: in posseduto da qualcuno ora | errore |
| 12 | Reversal di un cambio | rosa e crediti ripristinati, swaps_used-- |
| 13 | Chiamata diretta API fuori sessione (no UI) | errore server-side |
| 14 | open_session ritentata | +5 accreditato una sola volta |
