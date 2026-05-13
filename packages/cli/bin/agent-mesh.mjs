#!/usr/bin/env node
/* eslint-disable no-undef */
import('../dist/index.js').then(({ main }) => main(process.argv.slice(2)));
