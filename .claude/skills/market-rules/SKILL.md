---
name: market-rules
description: Buy/sell/swap algorithms, validation rules, and the test-case table for SuperLega market operations. Load when implementing or testing market functions.
---

# Market rules — algorithms and test cases

**Model v2 (2026-09-10)**: operations are separate. Release first, buy later,
same role by count. `swap_player`/`free_swap_player` remain in the DB (a swap is
a release + a purchase) but the UI no longer uses them.

## sell_player(team, player) — pseudocode

```
lock teams row FOR UPDATE; assert caller can manage team; throttle
assert session open (now within window) — shared lock on the session row
assert player currently in roster; assert players.status = 'active' (else USE_FREE_RELEASE)
refund = players.qt_a (sale_price_rule)
close roster row (released_via = 'sell'); team.credits += refund
insert transactions (kind 'sell', player_out, refund, credits_delta = +refund, counts = false)
```

## release_out_of_list(team, player)

Any time. `players.status = 'out_of_list'`; refund = roster.price_paid
(`free_swap_refund_rule`); `released_via = 'free_release'`; kind
`free_release`; counts = false; session_id = current session or null.

## buy_player(team, player)

```
lock team; throttle; lock players row FOR UPDATE (serialises free purchases)
assert player active and not already in roster
assert role_slots(team, role) > 0      -- composition[role] − current roster count in role  (NO_ROLE_SLOT)
free = free_slots(team, role) > 0      -- free releases − free purchases, non-reversed, from the ledger
if free:  assert player in free_agents (now); session = current or null; counts = false
else:     assert session open; player in session_free_agents(session); swaps_used < 20; counts = true; swaps_used += 1
cost = players.qt_a; assert credits − cost >= 0
insert roster row (acquired_via 'buy', price_paid = cost); credits −= cost
insert transactions (kind 'buy', player_in, cost, credits_delta = −cost, counts_toward_limit = not free)
```

## open / close / sync_market_sessions

Open: scheduled→open, snapshot free agents, +extra_budget once, email. Close:
open→closed, validation report (23, 3/7/7/6, no out-of-list, credits ≥ 0).
`sync_market_sessions()` (any authenticated user, every page load, cron) closes
expired open sessions and opens the earliest due scheduled one.

## reverse_transaction(tx, reason) — admin only

Field-driven inverse: removes player_in, restores player_out at his last
price, inverts credits, decrements swaps_used if it counted. Works for sell,
buy, free_release, swap, free_swap, admin_*. Never deletes; a reversal cannot
be reversed; one reversal per operation.

## Test cases (tests/db/m11_market_sell_buy.test.sql, m4_market.test.sql)

| #   | Caso                                                  | Esito atteso                                    |
| --- | ----------------------------------------------------- | ----------------------------------------------- |
| 1   | Svincolo a sessione chiusa                            | errore SESSION_NOT_OPEN                         |
| 2   | Acquisto senza posto libero nel ruolo                 | errore NO_ROLE_SLOT                             |
| 3   | Svincolo gratuito di un fuori lista                   | ok, rimborso = pagato, non conta                |
| 4   | Acquisto del sostituto fuori sessione (slot gratuito) | ok, svincolati attuali, non conta               |
| 5   | Difensore per un buco da attaccante                   | errore NO_ROLE_SLOT                             |
| 6   | Due svincoli D + acquisti D in sessione               | ok, ogni acquisto conta 1, crediti = Qt.A       |
| 7   | Centrocampista per un buco da difensore               | errore                                          |
| 8   | Crediti insufficienti                                 | errore, nulla scritto                           |
| 9   | Terzo difensore senza buco                            | errore                                          |
| 10  | Ricomprare nella stessa sessione chi si è svincolato  | errore NOT_FREE_AGENT (era posseduto alla foto) |
| 11  | Manager di un'altra squadra                           | errore FORBIDDEN                                |
| 12  | Annullamento di un acquisto                           | giocatore fuori, crediti e contatore indietro   |
| 13  | Annullamento di uno svincolo                          | giocatore rientra al vecchio prezzo             |
| 14  | Chiusura con buchi                                    | report `invalid ≥ 1`                            |
