const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const portfolio = false;
const workflow = fs.readFileSync(path.join(__dirname, '../workflows/release-conventions.yml'), 'utf8');
const script = workflow.split('          script: |\n')[1].split('  release-policy:')[0]
  .split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const normalize = new AsyncFunction('github', 'context', 'core', script);
async function run(title, overrides = {}) {
  const edits = [];
  const pr = { number: 1, title,
    body: 'PR created automatically by Jules for task [123](https://jules.google.com/task/123)',
    user: { login: 'owner' }, head: { ref: 'code-health/helpers', repo: { full_name: 'owner/project' } }, ...overrides };
  const result = await normalize({ rest: { pulls: {
    get: async () => ({ data: pr }), update: async edit => { edits.push(edit); },
  } } }, { repo: { owner: 'owner', repo: 'project' }, issue: { number: 1 } }, { info: () => {} });
  return { result, edits };
}
describe('Jules PR title policy', () => {
  const fixtures = [
    ['⚡ Optimize fitText using binary search', 'perf: Optimize fitText using binary search'],
    ['⚡ [performance improvement] Replace redundant traversal', 'perf: Replace redundant traversal'],
    ['🧹 [code health improvement] Refactor helpers', 'refactor: Refactor helpers'],
    ['🧹 refactor: Extract decoding logic', 'refactor: Extract decoding logic'],
    ['🧪 Add missing error test for size limits', 'test: Add missing error test for size limits'],
    ['🔒 Fix XSS vulnerability', 'fix: Fix XSS vulnerability'],
    ['🔒 Add noopener noreferrer', 'fix: Add noopener noreferrer'],
  ];
  for (const [original, normal] of fixtures) it('repairs ' + original, async () => {
    const expected = portfolio ? normal.replace(/(: )([A-Z])/, (_, prefix, letter) => prefix + letter.toLowerCase()) : normal;
    const { result, edits } = await run(original);
    assert.equal(result, expected);
    assert.deepEqual(edits, [{ owner: 'owner', repo: 'project', pull_number: 1, title: expected }]);
  });
  for (const title of ['fix: preserve title', 'feat(search)!: change API', 'test(board): cover 🎵 Unicode']) {
    it('preserves ' + title, async () => assert.deepEqual(await run(title), { result: title, edits: [] }));
  }
  it('leaves other contributors alone', async () => assert.deepEqual(await run('Add a feature', { body: 'Regular PR' }), { result: 'Add a feature', edits: [] }));
  it('leaves forks alone', async () => assert.deepEqual(await run('⚡ Optimize', { head: { ref: 'jules-task', repo: { full_name: 'someone/fork' } } }), { result: '⚡ Optimize', edits: [] }));
  it('recognizes a Jules branch without a body', async () => assert.equal((await run('⚡ Optimize', { body: null, head: { ref: 'jules/task', repo: { full_name: 'owner/project' } } })).result, portfolio ? 'perf: optimize' : 'perf: Optimize'));
  it('treats shell syntax as data', async () => assert.equal((await run('⚡ Optimize $(touch nope) "quoted"')).result, portfolio ? 'perf: optimize $(touch nope) "quoted"' : 'perf: Optimize $(touch nope) "quoted"'));
  it('rejects empty and multiline titles', async () => {
    await assert.rejects(run('⚡ '), /Cannot normalize/);
    await assert.rejects(run('⚡ Optimize\nother'), /Cannot normalize/);
  });
  if (portfolio) {
    it('preserves the custom post type', async () => assert.deepEqual(await run('post: update a case study'), { result: 'post: update a case study', edits: [] }));
    it('repairs sentence case on prefixed Jules titles', async () => assert.equal((await run('fix: Repair search')).result, 'fix: repair search'));
    it('limits generated titles to commitlint header length', async () => assert.equal((await run('⚡ ' + 'A'.repeat(150))).result.length, 100));
  }
});
