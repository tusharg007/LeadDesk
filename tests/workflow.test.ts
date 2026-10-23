import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('n8n workflow keeps credentials out of prompts and connects bounded tools', async () => {
  const workflow = JSON.parse(
    await readFile(new URL('../n8n/qualification.workflow.json', import.meta.url), 'utf8'),
  );
  const nodes = new Map<string, any>(workflow.nodes.map((n: any) => [n.name, n]));
  assert.equal(workflow.active, false);
  assert.equal(nodes.get('Qualification webhook').parameters.authentication, 'headerAuth');
  assert.equal(nodes.get('Qualification webhook').parameters.responseMode, 'onReceived');
  const agent = nodes.get('Qualification agent');
  const model = nodes.get('Choose a chat model');
  assert.equal(model.type, '@n8n/n8n-nodes-langchain.lmChatGoogleGemini');
  assert.ok(!model.credentials, 'Credentials must be selected locally, never exported');
  assert.equal(workflow.connections[model.name].ai_languageModel[0][0].node, agent.name);
  assert.equal(agent.parameters.options.maxIterations, 6);
  assert.ok(!agent.parameters.text.includes('run_token'));
  assert.ok(!agent.parameters.options.systemMessage.includes('run_token'));
  assert.equal(workflow.settings.executionTimeout, 180);
  for (const name of ['Read lead context', 'Search service knowledge']) {
    assert.equal(workflow.connections[name].ai_tool[0][0].node, 'Qualification agent');
    const node = nodes.get(name);
    assert.ok(node.parameters.url.includes('run_id'));
    assert.ok(node.parameters.headerParameters.parameters[0].value.includes('run_token'));
    assert.ok(!node.parameters.url.includes('$fromAI'));
    assert.ok(
      node.parameters.jsonBody.includes('$fromAI'),
      'Gemini tools require nonempty input schemas',
    );
  }
  assert.equal(
    workflow.connections['Parse recommendation'].main[0][0].node,
    'Save for human review',
  );
  for (const connection of Object.values(workflow.connections) as any[]) {
    for (const branches of Object.values(connection) as any[])
      for (const branch of branches)
        for (const edge of branch) assert.ok(nodes.has(edge.node), `Missing node ${edge.node}`);
  }
});
