# Wersja polska: etap 1

Zrobione: interfejs po polsku, jednostki metryczne (kg, cm, g, ml), przecinek dziesiętny
i polskie daty, prompty z polskim kontekstem, etykiety UE (na 100 g, sól, kJ), polskie pytania
doprecyzowujące i uzasadnienia pewności, aktualne modele Google.

Jeszcze nie zrobione (etap 2):

- Import produktów z Open Food Facts Polska (kody kreskowe). Do tego czasu wbudowana baza
  nie ma żadnych kodów, a skan kodu korzysta z wyszukiwania w sieci (wymaga klucza API).
- Polskie nazwy produktów w bazie. Wyszukiwarka ręczna dalej szuka po angielsku (USDA).
- Tłumaczenie ekranów i komunikatów publik API (w forku bez tokena są ukryte).

Konwersje w kodzie: 1 g soli = 400 mg sodu, 1 kcal = 4,184 kJ (`packages/core-schema/src/eu-units.ts`).
Lista modeli Google: `packages/prompt/src/providers.ts`. Google wycofuje modele co kilka miesięcy.
