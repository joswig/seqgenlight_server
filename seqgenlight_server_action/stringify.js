import { readFileSync } from 'fs';

const code = readFileSync('./dist/action.js', 'utf-8');
const stringified = JSON.stringify(code);
console.log(stringified);
