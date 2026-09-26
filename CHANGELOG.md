# Changelog — TrackBack

## 2026-09-26 — Portail bilingue, nouvelles résolutions et fonctionnalités par plan

### Ajouts

**Portail client**
- Portail bilingue anglais / français qui suit la langue de la boutique, textes personnalisables par langue.
- Portail affiché dans le thème de la boutique via l'App Proxy (`/apps/returns`), avec option pleine page.
- Page de suivi du retour (`?mode=status`) : chronologie, instructions de retour, saisie du numéro de suivi ; liée dans chaque e-mail.
- Bouton de rétractation UE (`?mode=withdraw`, directive 2023/2673) : parcours en 2 étapes sans compte et accusé de réception immédiat.
- Nouveaux modes de retour : dépôt en boutique et enlèvement par coursier, en plus de l'envoi par le client et de l'étiquette prépayée.
- Photos (jusqu'à 3 par article), obligatoires selon le motif (Starter+).
- Frais et bonus affichés avant validation ; le serveur recalcule tout.

**Résolutions**
- Remboursement des commandes payées à la livraison : le client indique son compte (Wave, Orange Money, MTN MoMo, Moov Money, M-Pesa, Airtel Money, virement, espèces) et le marchand enregistre le paiement avec sa référence ; Shopify enregistre le remboursement.
- Cartes-cadeaux Shopify (Starter+), utilisées automatiquement à la place de l'avoir pour les commandes sans compte client.
- Échanges en libre-service (Starter+) : le client choisit lui-même la taille ou la couleur, stock vérifié en direct.
- Shop Now (Pro) : échange contre n'importe quel produit de la boutique.
- Retours verts (Starter+) : sous un montant défini, le client garde l'article.
- Frais de restockage et de retour (Starter+), exemptions par motif, frais offerts pour les avoirs et échanges.

**Opérations**
- Automatisations (Pro) : conditions d'auto-approbation (montant maximum, clients à risque exclus), remboursement automatique à réception.
- Score de risque et liste noire de clients (Pro).
- WhatsApp (Pro) : bouton sur la page de suivi, message prêt à envoyer sur chaque retour, notifications automatiques via l'API Cloud de Meta.
- Export CSV des retours filtrés.
- Tâche quotidienne : expiration des retours non expédiés, rapport hebdomadaire du lundi (Starter+), purge du rate limiting.
- Tags de commandes Shopify (Starter+) : `trackback-return`, `trackback-exchange`, `trackback-refunded`…

**E-mails et analytics**
- 8 e-mails en anglais et en français (nouveaux : « Reçu », « Expiré », « Rétractation reçue »), envoyés dans la langue du client, réponses vers l'e-mail du marchand.
- Nouvelles variables : `{{return_instructions}}`, `{{refund_details}}`, `{{status_url}}`, `{{items_list}}`…
- Analytics : taux de retour (comparé aux commandes Shopify), répartition des résolutions, frais encaissés.

**Intégrations (Pro)**
- Webhooks sortants signés HMAC-SHA256 (`return.created` … `return.expired`) avec événement de test.
- API REST v1 : `GET /api/v1/returns`, `GET /api/v1/returns/{rma}`, clés stockées hachées.

### Améliorations
- Réglages réorganisés en 9 onglets : Général, Éligibilité, Retours et frais, Remboursements, Motifs, Politique, Notifications, Intégrations, Portail.
- Fonctionnalités réparties par plan depuis une source unique (`app/lib/plans.ts`), avec badges et invitations à passer au plan supérieur.
- Actions groupées : mêmes e-mails et synchronisations Shopify que les actions unitaires.
- Fenêtre de retour calculée depuis l'expédition (ou la date de commande, au choix).
- Règles « non retournable » exactes (SKU, tags, types de produits) : plus de blocage par sous-chaîne.
- Tableau de bord : rétractations UE en attente et retours à risque.
- Montants formatés selon la langue du client dans le portail et les e-mails.
- Pages plus légères : le chunk JavaScript partagé (portail inclus) passe de 803 kB à 73 kB grâce à un registre explicite des icônes (`app/components/icon-registry.ts`).
- Documentation intégrée (`/app/docs`) réécrite ; nouvelles sections Remboursements, Analytics, Webhooks et API.
- Index de base de données sur les requêtes fréquentes.

### Corrections
- Les plans annuels étaient traités comme Free à plusieurs endroits.
- La synchronisation Shopify pouvait faire reculer le statut d'un retour (webhook tardif).
- Remise en stock silencieusement en échec (scope `read_locations` manquant).
- Double remboursement possible en cas de double clic ou d'action simultanée.
- Webhooks RGPD traités sans attendre la fin ; l'export RGPD inclut désormais paiements, photos et chat.
- Suppression d'images Cloudinary possible hors du dossier de la boutique.
- Icônes invisibles dans l'admin et le portail (indicateurs de chargement, alertes, éditeur).
- Portail intégré en iframe bloqué par la politique `frame-ancestors` ; thème clair forcé dans le portail.

### Sécurité
- Sessions du portail, du chat et des liens de suivi signées (HMAC) ; plus d'écriture avec `?shop=` seul.
- Revalidation serveur de l'éligibilité, des quantités, des frais et des montants.
- Recherche de commande protégée contre l'injection de syntaxe de recherche.
- Rate limiting en base sur les endpoints publics ; comparaisons de secrets en temps constant.

### Technique
- Logique métier pure (`returns-logic.ts`) couverte par Vitest ; CI GitHub Actions (typecheck, tests, build).
- Service unique pour toutes les transitions de statut (`returns-service.server.ts`).
- Build Vercel sans `--accept-data-loss` : un changement de schéma destructif fait échouer le build au lieu de supprimer des données.
- `.env.example` et README réécrits ; suppression de la page d'exemple du template (`app.additional.tsx`).

### Actions de déploiement
1. Mettre à jour `SCOPES` sur Vercel (voir `.env.example`) et définir `CRON_SECRET` (et idéalement `TOKEN_SECRET`, `MAIL_FROM`).
2. `npx shopify app deploy --config shopify.app.returnflow.toml` (scopes, webhooks, App Proxy, extension).
3. Les marchands acceptent les nouveaux scopes à la prochaine ouverture de l'app.
4. Demander l'accès aux données client protégées dans le Partner Dashboard.
