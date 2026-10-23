# Wersja polska: etap 1

Zrobione: interfejs po polsku, jednostki metryczne (kg, cm, g, ml), przecinek dziesiętny
i polskie daty, prompty z polskim kontekstem, etykiety UE (na 100 g, sól, kJ), polskie pytania
doprecyzowujące i uzasadnienia pewności, aktualne modele Google.

Jeszcze nie zrobione (etap 2):

- Kody kreskowe: wbudowana baza OFF Polska, potem Open Food Facts API. Brak trafienia odsyła do
  trybu Etykieta. Wyszukiwanie w sieci przez Gemini jest wyłączone (`WEB_LOOKUP_ENABLED` w
  `orchestrator.ts`), bo grounding z Google Search nie działa na darmowym kluczu.
- Polskie nazwy produktów w bazie. Wyszukiwarka ręczna dalej szuka po angielsku (USDA).
- Usunięty został cały podsystem publik API (zarządzany klucz, portfel, ekrany); aplikacja działa wyłącznie na własnym kluczu użytkownika.

Konwersje w kodzie: 1 g soli = 400 mg sodu, 1 kcal = 4,184 kJ (`packages/core-schema/src/eu-units.ts`).
Lista modeli Google: `packages/prompt/src/providers.ts`. Google wycofuje modele co kilka miesięcy.
