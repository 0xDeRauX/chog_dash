Projet — Dashboard CHOG (memecoin Monad)

Contexte et objectif

Construire un dashboard d'indicateurs de performance et d'engouement pour le
memecoin CHOG sur la blockchain Monad. Vision : un outil qu'on ouvre
chaque jour, qui laisse l'utilisateur tirer ses propres conclusions en
comparant CHOG aux memecoins des autres blockchains (prix vs sentiment vs
communauté). C'est une comparaison de la communauté CHOG face aux autres.

Panel de comparaison retenu : CHOG au centre, entouré de PEPE (Ethereum),
WIF et BONK (Solana), BRETT (Base). 4 à 6 comparables max pour que le
dashboard reste lisible au quotidien.

Cas X / Twitter — résolu

X n'a plus de tier gratuit exploitable (pay-per-use $0.005/tweet lu depuis fév 2026).
Nitter, snscrape, Twint sont morts (guest tokens verrouillés) — ne rien bâtir dessus.
MAIS le besoin est limité à un seul chiffre par jour : le nombre de mentions CHOG.
Astuce : recherche sur 24h en ne demandant qu'une page de résultats, on lit juste
le compteur. Solutions gratuites/quasi-gratuites pour ce besoin précis :


Apify (actor TwitterAPI.io) : 5 $ de crédit gratuit renouvelé chaque mois →
reste à 0 $, scheduler intégré. Option la plus simple.
TwitterAPI.io direct : 5 $ offert qui dure des mois, simple appel HTTP.
X reste une source secondaire ; si elle tombe, le dashboard tient sur
Telegram/Reddit/Farcaster.

Mise à jour (2026-07) : l'API X officielle a un endpoint dédié au comptage,
`GET /2/tweets/counts/recent`, qui renvoie des compteurs agrégés (par bucket
horaire) sans jamais retourner les tweets eux-mêmes. Il est facturé
$0.005 par REQUÊTE (pas par tweet lu) — donc un appel/jour ≈ $0.15/mois,
peu importe le volume de mentions ce jour-là. C'est moins cher et plus direct
que TwitterAPI.io ou les scrapers Apify (qui facturent au tweet scrapé).
Nécessite un compte X Developer avec facturation pay-per-use activée
(Bearer token OAuth2 App-only) — à obtenir manuellement sur developer.x.com,
distinct de la clé TwitterAPI.io déjà en place dans .env.
Les actors Apify de scraping (ex: api-ninja/x-twitter-advanced-search à
$15/1000, ou des alternatives moins chères à $0.15-0.25/1000) restent
écartés pour ce besoin précis : ils facturent au tweet scrapé, donc le coût
scale avec le volume de mentions au lieu d'être un forfait fixe.


Indicateurs propriétaires à construire


Buzz Score normalisé — z-score des mentions quotidiennes vs moyenne
mobile 30j. Un pic à +2σ sur CHOG pendant que les comparables restent plats
= signal spécifique, pas du bruit de marché.
Divergence sentiment/prix (indicateur phare) — écart entre sentiment
normalisé et rendement prix 7j. Sentiment monte + prix stagne = accumulation
silencieuse potentielle.
Score d'organicité — entropie des auteurs (beaucoup de comptes = organique ;
peu de comptes très actifs = astroturfing) + ratio réactions/vues Telegram.
Vélocité communautaire relative — croissance membres Telegram + holders
on-chain CHOG, divisée par la médiane des comparables. Mesure les parts d'attention.
Score composite pondéré — tous les signaux dans un score 0-100, poids
ajustables et backtestables contre les mouvements de prix passés.