Pour tester l'application de bout en bout et vérifier que tout fonctionne parfaitement, voici le parcours idéal à suivre :

### 1. Préparation (Lancement)
*   Assure-toi que ton fichier `.env` contient bien une `DATABASE_URL` (PostgreSQL) et tes identifiants Gmail `SMTP_USER`/`SMTP_PASS`.
*   Lance l'application : `npm run dev`.
*   Ouvre l'application dans ton magasin de test Shopify.

### 2. Étape 1 : Configuration (Settings)
C'est ici que tu définis les règles du jeu.
*   Va dans l'onglet **Settings**.
*   **Général** : Modifie le délai de retour (ex: 30 jours) et active le "Store Credit".
*   **Emails** : Va dans l'onglet "Emails", sélectionne "Approved", modifie le sujet de l'email, et clique sur **Save**.
*   **Branding** : Change la couleur principale (ex: un violet plus foncé) et vérifie que l'aperçu à droite se met à jour.

### 3. Étape 2 : Le Portail Client (Côté Acheteur)
Tu vas simuler une demande de retour comme si tu étais un client.
*   Récupère le nom d'une commande existante (ex: `#1001`) et l'email du client associé dans ton interface Shopify Admin.
*   Ouvre le portail (L'URL est généralement `https://ton-magasin.myshopify.com/apps/returns`).
*   Saisis le numéro de commande et l'email.
*   Sélectionne un article, choisis une raison (celles que tu as configurées en étape 1) et sélectionne "Store Credit".
*   Soumets la demande. *Tu devrais recevoir un email de confirmation instantanément si ton SMTP est correct.*

### 4. Étape 3 : Gestion du Retour (Côté Admin)
Retourne dans l'interface de l'application dans ton Shopify Admin.
*   Va dans l'onglet **Returns**. Ta nouvelle demande doit apparaître en haut de la liste avec le statut `PENDING`.
*   Clique sur la ligne pour ouvrir les détails.
*   **Approuve le retour** : Dans la fenêtre qui s'ouvre, saisis un transporteur (ex: DHL) et un numéro de suivi fictif.
*   **Réception** : Une fois approuvé, clique sur "Mark as Received" quand tu as "reçu" le colis.
*   **Remboursement** : Clique sur "Issue Refund". Comme le client a choisi "Store Credit", TrackBack va appeler l'API Shopify pour créer un code promo automatiquement. Vérifie que le code apparaît bien dans les notes internes.

### 5. Étape 4 : Analyse et Facturation
*   Va dans l'onglet **Analytics**. Tu devrais voir un pic dans le graphique "Returns Over Time" et la raison du retour apparaître dans le diagramme circulaire.
*   Va dans l'onglet **Billing**. Tu verras que ta "Usage bar" a progressé (ex: 1 / 10 retours utilisés pour le plan gratuit).

### 💡 Astuce pour le Portail en local :
Si tu testes sur ton PC sans passer par le proxy Shopify, tu peux accéder directement au portail via cette URL :
`http://localhost:5173/portal?shop=ton-magasin.myshopify.com`

**C'est tout ! Si toutes ces étapes passent, ton application est prête pour le monde réel.** Souhaites-tu que j'ajoute un bouton "Copier le lien du portail" dans les réglages pour que ce soit plus simple pour toi ?