/**
 * 工作台中控服务。
 * 只负责把 UI 对话转换为平台交互请求，不包含六类视频类型工作流。
 */
export function createConsoleService({ platformSkill, eventBus, logger }) {
  function use(provider) {
    const adapter = platformSkill.use(provider);
    eventBus.emit("console:provider-changed", platformSkill.getStatus(provider));
    return adapter;
  }

  function current() {
    return platformSkill.current();
  }

  async function sendMessage({ text, context = {}, history = [], signal } = {}) {
    const content = String(text || "").trim();
    if (!content) throw new Error("中控消息不能为空。");
    const provider = current().provider;
    eventBus.emit("console:request-start", { provider, text: content });
    try {
      const result = await platformSkill.sendMessage({
        messages: [...history, { role: "user", content }],
        context,
        signal
      });
      eventBus.emit("console:request-complete", { provider, result });
      return result;
    } catch (error) {
      logger.error("中控请求失败", error);
      eventBus.emit("console:request-error", { provider, error });
      throw error;
    }
  }

  async function planCreativeTask(request = {}) {
    return platformSkill.planCreativeTask(request);
  }

  async function createCreativeTask(request = {}) {
    return platformSkill.createCreativeTask(request);
  }

  async function orchestrateCreativeTask(request = {}) {
    return platformSkill.orchestrateCreativeTask(request);
  }

  async function getTaskStatus(request = {}) {
    return platformSkill.getTaskStatus(request);
  }

  async function cancelTask(request = {}) {
    return platformSkill.cancelTask(request);
  }

  return {
    use,
    current,
    sendMessage,
    planCreativeTask,
    createCreativeTask,
    orchestrateCreativeTask,
    getTaskStatus,
    cancelTask,
    getStatus: provider => platformSkill.getStatus(provider)
  };
}
