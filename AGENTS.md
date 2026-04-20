# AGENTS

## Convenzioni operative (allineate allo storico)

- Usa commit piccoli e atomici (una modifica logica per commit).
- Formato messaggio commit: `type: descrizione`.
- `type` usati finora: `feat`, `fix`, `chore`, `docs`.
- Descrizione in inglese, minuscolo, stile imperativo, senza punto finale.
- Niente scope tra parentesi (es. no `feat(ui): ...`), perché finora non è stato usato.

## Comando commit standard

```bash
git add -A && git commit -m "<type>: <short description>"
```

## Trigger rapido: `git`

Quando l'utente scrive solo `git`, esegui automaticamente il flusso commit standard:

1. `git add -A`
2. `git commit -m "<type>: <short description>"` seguendo le convenzioni sopra
3. `git push`
4. mostra in output hash e subject del commit creato

## Trigger rapido: `localhost`

Quando l'utente scrive solo `localhost`, avvia automaticamente il server locale per visualizzare il sito:

1. `python3 -m http.server 8080`
2. comunica l'URL di accesso: `http://localhost:8080`

Esempi coerenti con i commit esistenti:

```bash
git add -A && git commit -m "feat: add guest RSVP deadline banner"
git add -A && git commit -m "fix: improve mobile spacing for gallery cards"
git add -A && git commit -m "chore: update runtime configuration defaults"
git add -A && git commit -m "docs: add local development notes"
```
