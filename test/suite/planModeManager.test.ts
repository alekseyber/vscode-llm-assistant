// Тесты PlanModeManager — полный цикл планирование/имплементация/рефлексия (мок AgentWorker/AgentOrchestrator)

import 'mocha';
import * as sinon from 'sinon';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlanModeManager } from '../../src/modes/chat/PlanModeManager';
import { AgentWorker } from '../../src/modes/apply/AgentWorker';
import { AgentOrchestrator } from '../../src/modes/apply/AgentOrchestrator';

/** Собрать полный WorkerResult из ответа */
function workerResult(answer: string): any {
  return { answer, steps: [], iterations: 1, inputTokens: 10, outputTokens: 20, cost: 0.001 };
}

suite('PlanModeManager', () => {
  let sandbox: sinon.SinonSandbox;
  let tmpDir: string;

  setup(() => {
    sandbox = sinon.createSandbox();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planmode-'));
  });

  teardown(() => {
    sandbox.restore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('generatePlan: возвращает planPath/content/planId (fallback на answer)', async () => {
    sandbox.stub(AgentWorker.prototype, 'run').resolves(workerResult('# План\nТест'));

    const pm = new PlanModeManager(tmpDir);
    const result = await pm.generatePlan('сделай X', {}, 'test-model');

    assert.ok(result.planPath.includes('.llma/plans/plan_'), 'путь должен указывать на .llma/plans/');
    assert.strictEqual(result.content, '# План\nТест', 'контент = answer (файл не записан моком)');
    assert.ok(result.planId.length > 0, 'planId не пустой');
  });

  test('generatePlan: пробрасывает sessionId + onEvent воркеру (F1 5a)', async () => {
    const runStub = sandbox.stub(AgentWorker.prototype, 'run').resolves(workerResult('# План'));
    const onEvent = (e: any) => {};

    const pm = new PlanModeManager(tmpDir, 'session_plan', onEvent);
    await pm.generatePlan('задача', {}, 'model');

    const worker = runStub.thisValues[0] as any;
    assert.strictEqual(worker.options.sessionId, 'session_plan');
    assert.strictEqual(worker.options.onEvent, onEvent);
  });

  test('reflect: все AC ✅ → allPassed true, один цикл', async () => {
    sandbox.stub(AgentWorker.prototype, 'run').resolves(workerResult('✅ AC-1: ок\n✅ AC-2: ок'));

    const pm = new PlanModeManager(tmpDir);
    const result = await pm.reflect(path.join(tmpDir, 'plan.md'), {}, 'test-model', 2);

    assert.strictEqual(result.allPassed, true);
    assert.strictEqual(result.cycles, 1);
  });

  test('reflect: ❌ → coder исправляет → повторный ✅ (2 цикла)', async () => {
    const runStub = sandbox.stub(AgentWorker.prototype, 'run');
    runStub.onCall(0).resolves(workerResult('❌ AC-1: не так'));   // reviewer cycle 0
    runStub.onCall(1).resolves(workerResult('исправлено'));         // coder
    runStub.onCall(2).resolves(workerResult('✅ AC-1: ок'));        // reviewer cycle 1

    const pm = new PlanModeManager(tmpDir);
    const result = await pm.reflect(path.join(tmpDir, 'plan.md'), {}, 'test-model', 2);

    assert.strictEqual(result.allPassed, true);
    assert.strictEqual(result.cycles, 2);
    assert.strictEqual(runStub.callCount, 3, 'reviewer + coder + reviewer');
  });

  test('reflect: ревьюер не справился (fallback) → allPassed false', async () => {
    sandbox.stub(AgentWorker.prototype, 'run').resolves(workerResult('исчерпан лимит итераций, не дал финального ответа'));

    const pm = new PlanModeManager(tmpDir);
    const result = await pm.reflect(path.join(tmpDir, 'plan.md'), {}, 'test-model', 2);

    assert.strictEqual(result.allPassed, false);
    assert.strictEqual(result.cycles, 2);
  });

  test('implementPlan: читает план и возвращает orchestratorResult', async () => {
    const planPath = path.join(tmpDir, 'plan.md');
    fs.writeFileSync(planPath, '# План\nЭтап 1', 'utf-8');

    sandbox.stub(AgentOrchestrator.prototype, 'execute').resolves({
      taskId: 'impl_1',
      strategy: 'sequential',
      workers: [],
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCost: 0.001,
      costPerWorker: {},
      success: true,
      summary: 'реализовано',
    });

    const pm = new PlanModeManager(tmpDir);
    const result = await pm.implementPlan(planPath, {}, 'test-model');

    assert.strictEqual(result.orchestratorResult.success, true);
    assert.strictEqual(result.orchestratorResult.summary, 'реализовано');
    assert.strictEqual(result.updatedPlan, '# План\nЭтап 1', 'updatedPlan = перечитанный файл');
  });
});
