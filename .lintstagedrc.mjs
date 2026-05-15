export default {
  '*.{ts,tsx,mjs,cjs,js}': ['eslint --fix --max-warnings=0 --no-warn-ignored', 'prettier --write'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
