// Confirm before destructive or hard-to-undo actions.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-confirm]');
  if (el && !window.confirm(el.dataset.confirm)) e.preventDefault();
});

// Quote / invoice line items: add and remove rows.
const items = document.getElementById('items');
const template = document.getElementById('item-template');
const addItem = document.getElementById('add-item');

if (items && template && addItem) {
  addItem.addEventListener('click', () => {
    items.appendChild(template.content.cloneNode(true));
    items.lastElementChild.querySelector('input').focus();
  });

  items.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-item');
    if (!btn) return;
    const rows = items.querySelectorAll('.item-row:not(.item-head)');
    if (rows.length > 1) {
      btn.closest('.item-row').remove();
    } else {
      btn.closest('.item-row').querySelectorAll('input').forEach((input) => { input.value = ''; });
    }
  });
}
