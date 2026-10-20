import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../pages/white-label-order.tsx', import.meta.url), 'utf8');
const review = readFileSync(new URL('./review-form.tsx', import.meta.url), 'utf8');
const notes = readFileSync(new URL('./notes-delivery.tsx', import.meta.url), 'utf8');

// Structural regression checks: these do not replace signed-in browser tests.
test('background refreshes cannot key-remount an unfinished review', () => {
  assert.match(page, /ReviewForm key=\{`\$\{o\.id\}-\$\{reviewRevision\}`\}/);
  assert.doesNotMatch(page, /ReviewForm key=\{[^}]*updatedAt/);
  assert.match(review, /initialVersion = useRef\(String\(o\.updatedAt\)\)/);
  assert.match(review, /const stale = initialVersion\.current !== String\(o\.updatedAt\)/);
  assert.match(review, /const save = \(st: string\) => \{\s*if \(stale \|\| review\.isPending\)/);
  assert.match(review, /const apply = \(st: string\) => \{\s*if \(stale \|\| review\.isPending\)/);
});

test('note drafts are scoped to order and audience, with editing locked during submission', () => {
  assert.match(page, /NoteForm key=\{`\$\{o\.id\}-internal`\}/);
  assert.match(page, /NoteForm key=\{`\$\{o\.id\}-customer`\}/);
  assert.match(notes, /<Textarea[^>]*disabled=\{add\.isPending\}/);
});

test('a failed background refresh preserves loaded order forms', () => {
  assert.match(page, /if \(!d\) return <ErrorState/);
  assert.doesNotMatch(page, /if \(q\.isError \|\| !d\)/);
  assert.match(page, /Could not refresh this order/);
});
