describe('Clear All Favorites', () => {
  let token;
  let books;

  beforeEach(() => {
    const username = `clear-favorites-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const password = 'e2e-password';
    cy.request('POST', 'http://localhost:4000/api/register', { username, password });
    cy.request('POST', 'http://localhost:4000/api/login', { username, password })
      .then(({ body }) => {
        token = body.token;
        return cy.request('http://localhost:4000/api/books');
      })
      .then(({ body }) => {
        books = body.slice(0, 2);
        expect(books).to.have.length(2);
        books.forEach(book => {
          cy.request({
            method: 'POST',
            url: 'http://localhost:4000/api/favorites',
            headers: { Authorization: 'Bearer ' + token },
            body: { bookId: book.id },
          });
        });
      });
    cy.intercept('GET', '**/api/favorites').as('favorites');
    cy.visit('/favorites', {
      onBeforeLoad(win) {
        win.localStorage.setItem('token', token);
        win.localStorage.setItem('username', username);
      },
    });
    cy.wait('@favorites');
    cy.get('li').should('have.length', 2);
  });

  const expectStoredFavorites = (count) => {
    cy.then(() => cy.request({
      url: 'http://localhost:4000/api/favorites',
      headers: { Authorization: 'Bearer ' + token },
    })).its('body').should('have.length', count);
  };

  it('confirms before clearing, disables repeat clicks, and persists the empty state', () => {
    const confirm = cy.stub().returns(true);
    cy.on('window:confirm', confirm);
    cy.intercept('DELETE', '**/api/favorites', req => {
      req.on('response', res => res.setDelay(300));
    }).as('clear');
    cy.contains('button', 'Clear All').click().then(() => {
      expect(confirm).to.have.been.calledOnceWith('Clear all favorite books? This cannot be undone.');
    });
    cy.contains('button', 'Clearing...').should('be.disabled');
    cy.get('li').should('have.length', 2);
    cy.wait('@clear').its('response.statusCode').should('eq', 200);
    cy.contains('No favorite books yet.').should('be.visible');
    cy.contains('button', 'Clear All').should('be.disabled');
    expectStoredFavorites(0);
    cy.reload();
    cy.contains('No favorite books yet.').should('be.visible');
    cy.contains('Books', { matchCase: true }).click();
    cy.get('[title="In Favorites"]').should('not.exist');
  });

  it('leaves favorites unchanged and sends no DELETE when confirmation is canceled', () => {
    const deletion = cy.spy();
    cy.intercept('DELETE', '**/api/favorites', deletion);
    cy.on('window:confirm', () => false);
    cy.contains('button', 'Clear All').click();
    cy.get('li').should('have.length', 2);
    expectStoredFavorites(2);
    cy.then(() => expect(deletion).not.to.have.been.called);
  });

  [
    ['server error', { statusCode: 500, body: { message: 'Storage unavailable' } }],
    ['network error', null],
  ].forEach(([scenario, response]) => {
    it(`shows and logs a ${scenario}, preserves favorites, and allows retry`, () => {
      cy.window().then(win => cy.stub(win.console, 'error').as('errorLog'));
      if (response) {
        cy.intercept({ method: 'DELETE', url: '**/api/favorites', times: 1 }, response).as('failedClear');
      } else {
        cy.window().then(win => cy.stub(win, 'fetch').rejects(new TypeError('Network unavailable')).as('failedFetch'));
      }
      cy.on('window:confirm', () => true);
      cy.contains('button', 'Clear All').click();
      if (response) cy.wait('@failedClear');
      cy.get('[role="alert"]').should('have.text', 'Failed to clear favorites. Please try again.');
      cy.get('@errorLog').should('have.been.calledOnce');
      cy.get('li').should('have.length', 2);
      expectStoredFavorites(2);
      if (!response) cy.get('@failedFetch').invoke('restore');
      cy.contains('button', 'Clear All').should('not.be.disabled').click();
      cy.contains('No favorite books yet.').should('be.visible');
      cy.get('[role="alert"]').should('not.exist');
      expectStoredFavorites(0);
    });
  });
});
