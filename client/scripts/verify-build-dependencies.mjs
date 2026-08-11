const requiredModules = ['@tailwindcss/oxide'];

for (const moduleName of requiredModules) {
  try {
    await import(moduleName);
  } catch {
    console.error(
      `[client:deps] Cannot load ${moduleName} for ${process.platform}/${process.arch}. `
      + 'Reinstall with optional dependencies enabled: npm ci --include=dev --include=optional',
    );
    process.exit(1);
  }
}

console.log(`[client:deps] Native build dependencies load on ${process.platform}/${process.arch}.`);
