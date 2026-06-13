try {
  // Simulate what better-sqlite3 does internally
  const bindings = require('bindings');
  console.log('bindings loaded, calling bindings...');
  // This is what better-sqlite3 does:
  const addon = bindings('better_sqlite3.node');
  console.log('addon loaded:', typeof addon);
  console.log('isInitialized:', addon.isInitialized);
} catch(e) {
  console.log('Error:', e.message);
  console.log(e.stack);
}
