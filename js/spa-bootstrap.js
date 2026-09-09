    // Startup sécurisé : vérification de la sécurité et du token avant d'accéder à l'application
    (async () => {
      const isAuthValid = await verifyAuthOnStartup();
      if (isAuthValid) {
        updateIdentityUI();
        renderContacts();
        renderHistory();
        initNetwork();
        registerWebPush();
      }
    })();
