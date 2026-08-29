/** DeepSeek Harness planning and approval API. */
export function createOrchestrationService({ http, eventBus, logger }) {
  async function listWorkflows() {
    const response = await http.get("/v1/orchestration/workflows", { timeoutMs: 15000 });
    return response.data?.workflows || [];
  }

  async function plan(request = {}) {
    eventBus.emit("orchestration:plan-start", request);
    try {
      const response = await http.post("/v1/orchestration/plans", {
        instruction: request.instruction,
        typeKey: request.typeKey || undefined,
        assets: Array.isArray(request.assets) ? request.assets : [],
        options: request.options || {},
        context: request.context || {}
      }, { timeoutMs: 90000 });
      const run = response.data?.run;
      eventBus.emit("orchestration:planned", run);
      return run;
    } catch (error) {
      logger.error("DeepSeek 调度计划失败", error);
      eventBus.emit("orchestration:error", { phase: "plan", error });
      throw error;
    }
  }

  async function execute(runId) {
    const response = await http.post(`/v1/orchestration/runs/${encodeURIComponent(runId)}/execute`, {}, { timeoutMs: 90000 });
    const run = response.data?.run;
    eventBus.emit("orchestration:dispatched", run);
    return run;
  }

  async function get(runId) {
    const response = await http.get(`/v1/orchestration/runs/${encodeURIComponent(runId)}`);
    return response.data?.run;
  }

  async function cancel(runId) {
    const response = await http.delete(`/v1/orchestration/runs/${encodeURIComponent(runId)}`);
    const run = response.data?.run;
    eventBus.emit("orchestration:cancelled", run);
    return run;
  }

  return { listWorkflows, plan, execute, get, cancel };
}
