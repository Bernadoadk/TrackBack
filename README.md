# TrackBack

Application Shopify intégrée (embedded) de gestion des retours : portail client bilingue (EN/FR) dans le thème
de la boutique, remboursements à l'origine ou contre-remboursement (mobile money, virement, espèces), avoirs,
cartes-cadeaux, échanges, bouton de rétractation UE, chat, WhatsApp, analytics, webhooks et API.

Chaque action est répercutée dans les retours, remboursements et stocks natifs de Shopify.

---

## Sommaire

- [Plans et fonctionnalités](#plans-et-fonctionnalités)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Démarrage local](#démarrage-local)
- [Variables d'environnement](#variables-denvironnement)
- [Tests et qualité](#tests-et-qualité)
- [Déploiement](#déploiement)
- [Configuration Shopify](#configuration-shopify)
- [Sécurité](#sécurité)
- [Base de données](#base-de-données)

---

## Plans et fonctionnalités

La source unique des plans et du verrouillage par plan est [`app/lib/plans.ts`](app/lib/plans.ts)
(`planTier`, `hasFeature`, `planLimit`, `PLANS`). Ne comparez jamais des noms de plans à la main.

| | Free | Starter | Pro |
|---|:---:|:---:|:---:|
| Prix | 0 $ | 19 $/mois · 182 $/an | 49 $/mois · 470 $/an |
| Demandes de retour / mois | 10 | 100 | Illimité |
| Portail EN/FR dans le thème, page de suivi du retour | ✓ | ✓ | ✓ |
| Règles d'éligibilité (fenêtre, soldes, articles non retournables) | ✓ | ✓ | ✓ |
| Modes de retour : envoi, étiquette, dépôt en boutique, enlèvement | ✓ | ✓ | ✓ |
| Remboursement contre-remboursement (Wave, Orange Money, MTN MoMo, M-Pesa…) | ✓ | ✓ | ✓ |
| Bouton de rétractation UE (directive 2023/2673) | ✓ | ✓ | ✓ |
| E-mails EN/FR, auto-approbation, expiration, analytics 7 jours, export CSV | ✓ | ✓ | ✓ |
| Éditeur de portail, éditeur d'e-mails | | ✓ | ✓ |
| Avoir + bonus, cartes-cadeaux, échanges de variante | | ✓ | ✓ |
| Frais de retour, photos, retours verts, motifs personnalisés | | ✓ | ✓ |
| Tags de commande Shopify, analytics 90 j, taux de retour, rapport hebdomadaire | | ✓ | ✓ |
| Échange contre n'importe quel produit (Shop Now) | | | ✓ |
| Chat en direct, WhatsApp | | | ✓ |
| Automatisations (conditions d'auto-approbation, remboursement automatique) | | | ✓ |
| Signaux de fraude et liste noire | | | ✓ |
| Webhooks, API REST, marque blanche | | | ✓ |

Les plans annuels (−20 %) sont gérés par la Billing API Shopify (`starter_annual`, `pro_annual`).
Les rétractations UE ne sont jamais bloquées par le quota mensuel.

---

## Stack technique

- **React Router 7** + `@shopify/shopify-app-react-router` v2 (App Bridge 4, session token automatique)
- **Admin GraphQL API** 2025-10 (retours, remboursements, avoirs, cartes-cadeaux, brouillons de commande) ; webhooks 2026-07
- **Prisma 6** + **PostgreSQL** (Neon)
- **Tailwind CSS** avec le design system maison (`app/components/ui.tsx`, utilitaires `rf-*`) et `lucide-react`
- **Nodemailer** (SMTP), **Cloudinary** (logos, photos de retour)
- **Vitest** + GitHub Actions

---

## Architecture

```
app/
├── routes/
│   ├── app.*                 Admin intégré (tableau de bord, retours, messages, analytics,
│   │                         éditeur de portail, e-mails, réglages, facturation, docs, onboarding)
│   ├── proxy.tsx             App Proxy /apps/returns (HMAC vérifié) → portail dans le thème (Liquid + iframe)
│   ├── portal.tsx            Page du portail client (retour, suivi ?mode=status, rétractation ?mode=withdraw)
│   ├── portal-api.*          API publique du portail (jetons signés, revalidation serveur, rate limiting)
│   ├── api.*                 Appels admin (chat, export CSV, recherche produits), cron, API REST v1
│   ├── webhooks.*            Webhooks Shopify (retours, remboursements, expéditions, RGPD, désinstallation)
│   └── support-console.tsx   Console de l'équipe support TrackBack
├── lib/
│   ├── plans.ts              Plans, quotas et fonctionnalités par plan
│   ├── returns-logic.ts      Règles pures : éligibilité, frais, retours verts, statuts Shopify, risque
│   ├── returns-service.server.ts  Toutes les transitions de statut (unitaire, groupé, automatisations)
│   ├── portal.server.ts      Recherche de commande, échanges, photos, soumission, rétractation, suivi
│   ├── i18n.ts               Textes EN/FR du portail et moyens de paiement mobile
│   ├── email-templates.ts    8 modèles d'e-mails EN/FR et variables
│   ├── notifications.server.ts  Envoi des e-mails / WhatsApp / webhooks sortants à chaque étape
│   ├── tokens.server.ts      Jetons HMAC (commande, chat, suivi)
│   └── …                     Facturation, rate limiting, rapports, synchronisation Shopify
└── components/
    ├── ui.tsx                Design system de l'admin
    ├── icon-registry.ts      Icônes lucide utilisables par nom (ajoutez-y toute nouvelle icône ; vérifié par les tests)
    └── portal/               Composants du portail client (5 mises en page)
extensions/theme-return-button/   Bloc de thème « Return button »
prisma/schema.prisma
tests/                        Tests unitaires de la logique pure
```

Documentation marchand intégrée : `/app/docs`.

---

## Démarrage local

Prérequis : Node `>=20.19 <22` ou `>=22.12`, [Shopify CLI](https://shopify.dev/docs/apps/tools/cli),
une base PostgreSQL, un compte SMTP et un compte Cloudinary.

```bash
npm install
cp .env.example .env    # puis complétez les valeurs
npm run dev             # prisma generate + prisma db push + shopify app dev
```

> ⚠️ `npm run dev` et `npm run setup` exécutent `prisma db push` sur `DATABASE_URL`.
> **Ne pointez jamais votre `.env` local vers la base de production** : utilisez une base ou une branche Neon dédiée.

Deux configurations Shopify existent :

- `shopify.app.toml` → app **TrackBack-dev** (tunnel Cloudflare, URLs mises à jour par `shopify app dev`)
- `shopify.app.returnflow.toml` → app **TrackBack** de production (`https://trackback-prod.vercel.app`)

```bash
npx shopify app config use shopify.app.toml
```

---

## Variables d'environnement

| Variable | Requise | Rôle |
|---|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | oui | Identifiants de l'app (le secret vérifie aussi les webhooks et l'App Proxy) |
| `SHOPIFY_APP_URL` | oui | URL publique de l'app |
| `SCOPES` | oui | Identique à `access_scopes.scopes` du TOML déployé |
| `DATABASE_URL` | oui | PostgreSQL |
| `BILLING_MODE` | prod | `production` = vrais paiements ; toute autre valeur = facturation de test |
| `CRON_SECRET` | prod | Protège `/api/cron/daily` (Vercel l'envoie automatiquement) |
| `TOKEN_SECRET` | recommandée | Secret des jetons du portail (défaut : `SHOPIFY_API_SECRET`). Le changer invalide les liens de suivi déjà envoyés |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | oui | Envoi des e-mails (587 STARTTLS, 465 SSL) |
| `MAIL_FROM` | recommandée | Adresse d'expédition (défaut : `SMTP_USER`) |
| `SMTP_FROM_NAME` | non | Nom d'expéditeur par défaut (les e-mails clients portent le nom de la boutique) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | oui | Logos et photos (un dossier par boutique) |
| `DISCORD_WEBHOOK_URL` | non | Alerte l'équipe TrackBack des messages du chat support |
| `SUPPORT_REPLY_TOKEN` | non | Protège la console de support et son API de réponse |
| `WHATSAPP_GRAPH_VERSION` | non | Version de la Graph API Meta (défaut `v23.0`) |
| `SHOP_CUSTOM_DOMAIN` | non | Domaine de boutique personnalisé |

Pour la délivrabilité, préférez un fournisseur transactionnel (Brevo, Postmark, Amazon SES…) à une boîte Gmail.

---

## Tests et qualité

```bash
npm test                 # Vitest : éligibilité, frais, statuts, i18n, e-mails, jetons, icônes
npm run typecheck        # react-router typegen + tsc
npx react-router build
```

La CI (`.github/workflows/ci.yml`) exécute `npm ci`, `prisma generate`, le typecheck, les tests et le build
à chaque push sur `main` et sur chaque pull request.

---

## Déploiement

### Vercel

- Build (`vercel.json`) : `prisma generate && prisma db push && react-router build`.
  Sans `--accept-data-loss`, `db push` **échoue** au lieu de supprimer des données si un changement est destructif.
- Cron quotidien `/api/cron/daily` à 06:00 UTC : expiration des retours non expédiés, rapport hebdomadaire
  (le lundi), purge du rate limiting.
- Définissez toutes les variables ci-dessus dans le projet Vercel, en particulier `SCOPES`, `CRON_SECRET`
  et `BILLING_MODE=production`.

### Configuration Shopify

```bash
npx shopify app deploy --config shopify.app.returnflow.toml
```

Cette commande publie les scopes, les webhooks, l'App Proxy et l'extension de thème. Après un ajout de scopes,
les marchands doivent accepter les nouvelles autorisations à la prochaine ouverture de l'app.

### Docker

Un `Dockerfile` est fourni (`npm run docker-start` exécute `setup` puis `start`).

---

## Configuration Shopify

- **Scopes** : `read_orders`, `write_orders`, `read_returns`, `write_returns`, `read_customers`, `read_products`,
  `read_fulfillments`, `read_assigned_fulfillment_orders`, `read_merchant_managed_fulfillment_orders`,
  `read_draft_orders`, `write_draft_orders`, `write_gift_cards`, `read_store_credit_accounts`,
  `read_store_credit_account_transactions`, `write_store_credit_account_transactions`, `read_locations`.
- **App Proxy** : `/apps/returns` → `/proxy`.
- **Webhooks** : `returns/*`, `refunds/create`, `fulfillments/create`, `shop/update`, `app/uninstalled`,
  `app/scopes_update` et les trois webhooks RGPD obligatoires.
- **Données client protégées** : l'app lit le nom, l'e-mail, le téléphone et l'adresse des clients —
  demandez l'accès « Protected customer data » (niveau 2) dans le Partner Dashboard avant la publication.
- **Commandes de plus de 60 jours** : sans le scope `read_all_orders` (sur demande à Shopify), les commandes
  plus anciennes sont invisibles. Gardez les fenêtres de retour ≤ 60 jours ou demandez ce scope.

---

## Sécurité

- Le portail n'utilise jamais `?shop=` seul pour écrire : chaque session de retour repose sur un jeton HMAC
  (commande + e-mail vérifiés, 2 h), et le serveur recalcule éligibilité, quantités, frais et montants.
- Recherche de commande protégée contre l'injection de syntaxe de recherche Shopify.
- Rate limiting en base sur les endpoints publics (recherche, soumission, photos, chat).
- Chat client authentifié par jeton ; liens de suivi signés (1 an).
- Webhooks entrants vérifiés par HMAC ; webhooks sortants signés (`X-TrackBack-Signature: sha256=…`).
- Clés d'API stockées hachées (SHA-256), affichées une seule fois.
- Verrou anti double remboursement ; photos Cloudinary cloisonnées par boutique.

---

## Base de données

Le schéma est appliqué par `prisma db push` (pas de migrations versionnées). Tant que c'est le cas,
**gardez les changements additifs** : nouvelles tables, colonnes optionnelles ou avec valeur par défaut,
index non uniques. Pas de suppression, de renommage, de changement de type ni de nouvelle contrainte
d'unicité sur une table existante sans plan de migration des données.
