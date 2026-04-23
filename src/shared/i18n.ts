import type {
  PromptSourceType,
  PromptStatus,
  PrompterCommandId,
  PrompterSettings,
  PrompterView
} from './models';

type Locale = PrompterSettings['language'];

export function isUncategorizedGroupName(groupName: string): boolean {
  return groupName === '未分类' || groupName === 'Uncategorized';
}

const shortcutLabels = {
  'zh-CN': {
    'prompter.open': 'Open Prompter',
    'prompter.importSelection': 'Import Selection',
    'prompter.importResource': 'Import Resource',
    'prompter.importTerminalSelection': 'Import Terminal Selection'
  },
  en: {
    'prompter.open': 'Open Prompter',
    'prompter.importSelection': 'Import Selection',
    'prompter.importResource': 'Import Resource',
    'prompter.importTerminalSelection': 'Import Terminal Selection'
  }
} satisfies Record<Locale, Record<PrompterCommandId, string>>;

const text = {
  'zh-CN': {
    sidebarAriaLabel: 'Prompter 分区',
    sidebarLabels: {
      workspace: '工作台',
      history: '历史',
      shortcuts: '快捷键',
      settings: '设置'
    } satisfies Record<PrompterView, string>,
    workspace: {
      composerAriaLabel: 'Prompt 编辑区',
      titleToggle: '标题',
      titleToggleOpenTitle: '关闭标题',
      titleToggleClosedTitle: '添加标题',
      newDraftTitle: '新建（当前内容将存入未使用）',
      clearPromptTitle: '清空当前 prompt',
      titleInputAriaLabel: '标题',
      titlePlaceholder: '标题（可选）',
      promptInputAriaLabel: 'Prompt',
      promptPlaceholder: '使用 Markdown 编写你的 prompt...',
      submitButton: '确认',
      promptStatusHeading: 'Prompt 状态区',
      promptStatusLanesSubtitle: '按泳道管理今日 prompt 与进行中的任务。',
      promptStatusListSubtitle: '显示全部 prompt，按优先级和最新时间排序。',
      promptStatusViewAriaLabel: 'Prompt 状态区视图',
      boardView: '三泳道',
      listView: '列表视图',
      listViewAriaLabel: 'Prompt 列表视图',
      trashZoneIdle: '拖拽至此删除',
      trashZoneOver: '松开以删除',
      cardCount: (count: number) => `${count} 张卡片`,
      emptyLane: '暂无卡片',
      laneBulkCompleteTitle: '一键完成',
      laneBulkAcknowledgeTitle: '一键确认',
      laneBulkDeleteTitle: '一键删除',
      laneBulkCompleteConfirm: (count: number) => `确认将当前 ${count} 张卡片标记为已完成？`,
      laneBulkAcknowledgeConfirm: (count: number) => `确认将当前 ${count} 张待确认卡片移入已完成？`,
      laneBulkDeleteConfirm: (count: number) => `确认删除当前 ${count} 张卡片？`,
      laneConfirmAgainHint: '再次点击以确认（3 秒内有效）'
    },
    laneLabels: {
      unused: '未使用',
      active: '使用中',
      completed: '已完成'
    } satisfies Record<PromptStatus, string>,
    card: {
      copied: '已复制',
      deletePrompt: '删除 prompt',
      deleteSessionConfirmTitle: '删除确认',
      deleteSessionConfirmBody: (count: number) =>
        count > 1
          ? `这 ${count} 条 prompt 将从工作台移除，当天也不会再被重新导入。是否继续？`
          : '该 prompt 将从工作台移除，当天也不会再被重新导入（同会话后续的新 prompt 仍会正常出现）。是否继续？',
      deleteSessionConfirmOk: '确认删除',
      deleteSessionConfirmDontAsk: '确认并不再提示',
      deleteSessionConfirmCancel: '取消',
      createdAt: '创建于',
      paused: '已暂停',
      awaitingConfirmation: '已完成，待确认',
      awaitingConfirmationAction: '已完成，待确认，点击移入已完成',
      expandPrompt: '展开完整 prompt',
      collapsePrompt: '收起完整 prompt',
      renameGroup: 'Rename group',
      renameGroupTitle: '点击修改分组',
      groupNameInputAriaLabel: 'Group name',
      jumpToSource: (source: string) => `在 ${source} 中打开`
    },
    sourceLabels: {
      'claude-code': 'Claude Code',
      codex: 'Codex',
      'roo-code': 'Roo Code'
    } satisfies Partial<Record<PromptSourceType, string>>,
    settings: {
      generalHeading: '通用',
      generalSubtitle: '切换界面语言。',
      language: '语言',
      theme: '主题',
      themeSystem: '跟随系统',
      themeLight: '浅色',
      themeDark: '深色',
      themeCustom: '自定义',
      defaultImportMode: '默认导入方式',
      relativePath: '相对路径',
      absolutePath: '绝对路径',
      notificationsHeading: '通知',
      notificationsSubtitle: '控制 prompt 生命周期通知和完成提示音。',
      experimentalHeading: '实验功能',
      experimentalSubtitle: '控制仍在验证中的 prompt 行为。',
      enableExperimentalPromptPause: '启用 Prompt 暂停实验功能',
      enableExperimentalPromptPauseHint: '自动识别工具调用等待并将 prompt 标记为暂停。',
      notifyOnFinish: 'Prompt 完成时通知',
      notifyOnPause: 'Prompt 暂停时通知',
      completionTone: '完成提示音',
      toneOff: '关闭',
      toneSoftBell: '轻提示音',
      toneChime: '钟声',
      toneDing: '叮声',
      toneCustom: '自定义文件',
      customTonePath: '自定义提示音路径',
      storageHeading: '存储与日志',
      storageSubtitle: '配置 Prompter 数据目录和 coding agent 日志目录。',
      dataDirectory: '数据目录',
      whenSwitchingDirectories: '切换目录时',
      startWithEmptyDirectory: '使用空目录开始',
      migrateExistingData: '迁移现有数据',
      applyDataDirectory: '应用数据目录',
      enableLogs: (source: string) => `启用 ${source} 日志`,
      logPath: (source: string) => `${source} 日志路径`,
      cacheHeading: '缓存',
      cacheSubtitle: '清除当前工作区的缓存 prompt 数据和导入状态。',
      clearCache: '缓存清理'
    },
    history: {
      empty: '还没有 prompt 活动记录。',
      importProgressLabel: '历史导入进度',
      importInProgressTitle: '历史导入中',
      importForegroundReady: '今日 prompt 已优先加载，工作台现在应该可以正常使用。',
      importStart: '开始',
      importPause: '暂停',
      importCompletedTooltip: '历史数据已经完全处理完毕',
      importReadySummary: '今日 prompt 已自动加载到工作台。',
      importBackfillSummary: '历史数据需要手动开始处理，可暂停并稍后继续。',
      importWarning: '历史日志处理可能会占用一定内存和时间。处理期间，VS Code / Cursor 可能出现短暂卡顿，这是正常现象。建议尽量在暂时不需要使用编辑器时进行处理。是否开始？',
      importProcessedPrompts: (processed: number, total?: number) =>
        total != null ? `已处理 ${processed} / ${total} 条 prompt` : `已处理 ${processed} 条 prompt`,
      importProcessedSources: (processed: number, total: number) => `已扫描 ${processed} / ${total} 个会话源`,
      selectedDayDetails: '选中日期详情',
      readOnlySubtitle: '只读展示所选日期记录下来的 prompt 卡片。',
      filterSubtitle: (status: string) => `仅显示「${status}」— 点击标签取消筛选`,
      noPromptsForDay: '当天没有记录任何 prompt。',
      noPromptsForStatus: (status: string) => `当天没有「${status}」的 prompts。`,
      activityHeading: '活跃度',
      activityDrilldown: (month: string, year: number) => `${month} ${year}`,
      heatmapAriaLabel: 'Prompt 活动热力图',
      previousYear: '上一年',
      nextYear: '下一年',
      less: '少',
      more: '多',
      backToYearView: '返回年视图',
      tooltipTotal: (total: number) => `总数: ${total}`,
      tooltipUnused: (count: number) => `未使用: ${count}`,
      tooltipCompleted: (count: number) => `已完成: ${count}`,
      copyContent: '复制内容',
      clickToExpand: '点击展开',
      clickToCollapse: '点击收起',
      itemsCount: (count: number) => `${count} 条`,
      statusCount: (status: string, count: number) => `${status} ${count}`
    },
    shortcuts: {
      heading: '快捷键',
      subtitle: '查看并调整 Prompter 的快捷键绑定。',
      tableAriaLabel: 'Prompter 快捷键',
      commandColumn: '命令',
      shortcutColumn: '快捷键',
      unassigned: '未分配',
      listening: '监听中...',
      saving: '保存中...',
      edit: '编辑',
      reset: '恢复',
      editAriaLabel: (label: string) => `编辑 ${label} 快捷键`,
      savingAriaLabel: (label: string) => `正在保存 ${label} 快捷键…`,
      resetAriaLabel: (label: string) => `恢复默认 ${label} 快捷键`,
      saved: (label: string) => `${label} 快捷键已保存。`,
      saveFailed: '保存快捷键失败。',
      conflictOpen: 'Open Prompter 不能和导入类命令使用同一个快捷键。',
      conflictWithOpen: (label: string) => `${label} 与 Open Prompter 冲突。`
    },
    host: {
      viewAction: '查看',
      reloadAction: '重新加载',
      notifications: {
        reloadAfterInstallOrUpgrade: 'Prompter 已安装或更新。请重新加载窗口以完成扩展启用。',
        promptAutoCompleted: (title: string) => `Prompt 已自动完成: ${title}...`,
        promptCompleted: (title: string) => `Prompt 已完成: ${title}...`,
        promptPaused: (title: string) => `Prompt 已暂停: ${title}...`,
        promptCompletedGeneric: 'Prompt 已完成',
        newRunningPrompt: (title: string) => `发现新的运行中 prompt: ${title}...`
      },
      confirmations: {
        clearCacheMessage: '是否确认清理 Prompter 缓存？此操作会移除当前工作区中的缓存 prompt 数据和导入状态。',
        clearCacheConfirm: '确认清理',
        cancel: '取消'
      },
      errors: {
        openPanelFailed: 'Prompter: 打开面板失败，详情请查看输出面板',
        importSelectionFailed: 'Prompter: 导入选区失败，详情请查看输出面板',
        activateFailed: 'Prompter 扩展激活失败，详情请查看 "输出" 面板 → Prompter',
        activateFailedRecovery: 'Prompter 扩展激活失败。请先打开设置页面，执行“缓存清理”，然后再重启 Cursor/VScode。',
        jumpToSourceFailed: (sourceType: string) => `无法跳转到 ${sourceType} 会话`,
        shortcutUnavailable: '当前面板不支持修改快捷键',
        shortcutRollbackFailed: (message?: string) =>
          message ? `回滚 Prompter 快捷键失败: ${message}` : '回滚 Prompter 快捷键失败',
        shortcutApplyFailed: (message?: string) => message ?? '应用 Prompter 快捷键失败'
      }
    }
  },
  en: {
    sidebarAriaLabel: 'Prompter sections',
    sidebarLabels: {
      workspace: 'Workspace',
      history: 'History',
      shortcuts: 'Shortcuts',
      settings: 'Settings'
    } satisfies Record<PrompterView, string>,
    workspace: {
      composerAriaLabel: 'Prompt composer',
      titleToggle: 'Title',
      titleToggleOpenTitle: 'Hide title',
      titleToggleClosedTitle: 'Add title',
      newDraftTitle: 'New prompt (current content will be saved to Unused)',
      clearPromptTitle: 'Clear current prompt',
      titleInputAriaLabel: 'Title',
      titlePlaceholder: 'Title (optional)',
      promptInputAriaLabel: 'Prompt',
      promptPlaceholder: 'Write your prompt in Markdown...',
      submitButton: 'Confirm',
      promptStatusHeading: 'Prompt Status',
      promptStatusLanesSubtitle: "Manage today's prompts and in-progress work by lane.",
      promptStatusListSubtitle: 'Show all prompts sorted by priority and most recent activity.',
      promptStatusViewAriaLabel: 'Prompt status views',
      boardView: 'Board',
      listView: 'List',
      listViewAriaLabel: 'Prompt list view',
      trashZoneIdle: 'Drag here to delete',
      trashZoneOver: 'Release to delete',
      cardCount: (count: number) => `${count} cards`,
      emptyLane: 'No cards yet',
      laneBulkCompleteTitle: 'Mark all completed',
      laneBulkAcknowledgeTitle: 'Acknowledge all',
      laneBulkDeleteTitle: 'Delete all',
      laneBulkCompleteConfirm: (count: number) => `Mark ${count} cards as completed?`,
      laneBulkAcknowledgeConfirm: (count: number) => `Move ${count} awaiting-confirmation cards to completed?`,
      laneBulkDeleteConfirm: (count: number) => `Delete ${count} cards?`,
      laneConfirmAgainHint: 'Click again to confirm (3s)'
    },
    laneLabels: {
      unused: 'Unused',
      active: 'In Progress',
      completed: 'Completed'
    } satisfies Record<PromptStatus, string>,
    card: {
      copied: 'Copied',
      deletePrompt: 'Delete prompt',
      deleteSessionConfirmTitle: 'Confirm deletion',
      deleteSessionConfirmBody: (count: number) =>
        count > 1
          ? `${count} prompts will be removed and will not be re-imported today. Continue?`
          : 'This prompt will be removed and will not be re-imported today (new prompts in the same session will still appear). Continue?',
      deleteSessionConfirmOk: 'Delete',
      deleteSessionConfirmDontAsk: 'Delete and don’t ask again',
      deleteSessionConfirmCancel: 'Cancel',
      createdAt: 'Created',
      paused: 'Paused',
      awaitingConfirmation: 'Completed, awaiting confirmation',
      awaitingConfirmationAction: 'Completed, awaiting confirmation. Move to completed.',
      expandPrompt: 'Expand full prompt',
      collapsePrompt: 'Collapse full prompt',
      renameGroup: 'Rename group',
      renameGroupTitle: 'Rename this group',
      groupNameInputAriaLabel: 'Group name',
      jumpToSource: (source: string) => `Open in ${source}`
    },
    sourceLabels: {
      'claude-code': 'Claude Code',
      codex: 'Codex',
      'roo-code': 'Roo Code'
    } satisfies Partial<Record<PromptSourceType, string>>,
    settings: {
      generalHeading: 'General',
      generalSubtitle: 'Choose the interface language.',
      language: 'Language',
      theme: 'Theme',
      themeSystem: 'Follow system',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeCustom: 'Custom',
      defaultImportMode: 'Default import mode',
      relativePath: 'Relative path',
      absolutePath: 'Absolute path',
      notificationsHeading: 'Notifications',
      notificationsSubtitle: 'Control prompt lifecycle alerts and the completion sound.',
      experimentalHeading: 'Experimental',
      experimentalSubtitle: 'Control prompt behaviors that are still being validated.',
      enableExperimentalPromptPause: 'Enable experimental prompt pause',
      enableExperimentalPromptPauseHint: 'Detect tool-wait states automatically and mark the prompt as paused.',
      notifyOnFinish: 'Notify when a prompt finishes',
      notifyOnPause: 'Notify when a prompt pauses',
      completionTone: 'Completion tone',
      toneOff: 'Off',
      toneSoftBell: 'Soft bell',
      toneChime: 'Chime',
      toneDing: 'Ding',
      toneCustom: 'Custom file',
      customTonePath: 'Custom tone path',
      storageHeading: 'Storage & logs',
      storageSubtitle: 'Configure where Prompter stores data and where coding agent logs are read from.',
      dataDirectory: 'Data directory',
      whenSwitchingDirectories: 'When switching directories',
      startWithEmptyDirectory: 'Start with empty directory',
      migrateExistingData: 'Migrate existing data',
      applyDataDirectory: 'Apply data directory',
      enableLogs: (source: string) => `Enable ${source} logs`,
      logPath: (source: string) => `${source} log path`,
      cacheHeading: 'Cache',
      cacheSubtitle: 'Remove cached prompt data and imported state from the local workspace.',
      clearCache: 'Clear Cache'
    },
    history: {
      empty: 'No prompt activity yet.',
      importProgressLabel: 'History import progress',
      importInProgressTitle: 'Importing history',
      importForegroundReady: 'Today\'s prompts are ready first, so the workspace should stay responsive.',
      importStart: 'Start',
      importPause: 'Pause',
      importCompletedTooltip: 'Historical data has already been fully processed',
      importReadySummary: 'Today\'s prompts have already been loaded into the workspace.',
      importBackfillSummary: 'Historical data must be started manually and can be resumed later.',
      importWarning: 'Processing historical logs may take noticeable memory and time. During processing, VS Code / Cursor may become temporarily sluggish. This is expected. We recommend running this when you do not need to actively use the editor. Start now?',
      importProcessedPrompts: (processed: number, total?: number) =>
        total != null ? `Processed ${processed} / ${total} prompts` : `Processed ${processed} prompts`,
      importProcessedSources: (processed: number, total: number) => `Scanned ${processed} / ${total} session sources`,
      selectedDayDetails: 'Selected day details',
      readOnlySubtitle: 'Read-only prompt cards captured on the selected day.',
      filterSubtitle: (status: string) => `Showing only "${status}" - click the pill again to clear the filter`,
      noPromptsForDay: 'No prompts recorded for this day.',
      noPromptsForStatus: (status: string) => `No "${status}" prompts were recorded for this day.`,
      activityHeading: 'Activity',
      activityDrilldown: (month: string, year: number) => `${month} ${year}`,
      heatmapAriaLabel: 'Prompt activity heatmap',
      previousYear: 'Previous year',
      nextYear: 'Next year',
      less: 'Less',
      more: 'More',
      backToYearView: 'Back to year view',
      tooltipTotal: (total: number) => `Total: ${total}`,
      tooltipUnused: (count: number) => `Unused: ${count}`,
      tooltipCompleted: (count: number) => `Completed: ${count}`,
      copyContent: 'Copy content',
      clickToExpand: 'Click to expand',
      clickToCollapse: 'Click to collapse',
      itemsCount: (count: number) => `${count} items`,
      statusCount: (status: string, count: number) => `${status} ${count}`
    },
    shortcuts: {
      heading: 'Shortcuts',
      subtitle: 'View and adjust Prompter shortcut bindings.',
      tableAriaLabel: 'Prompter shortcuts',
      commandColumn: 'Command',
      shortcutColumn: 'Shortcut',
      unassigned: 'Unassigned',
      listening: 'Listening...',
      saving: 'Saving...',
      edit: 'Edit',
      reset: 'Reset',
      editAriaLabel: (label: string) => `Edit ${label} shortcut`,
      savingAriaLabel: (label: string) => `Saving ${label} shortcut…`,
      resetAriaLabel: (label: string) => `Reset ${label} to default`,
      saved: (label: string) => `${label} shortcut saved.`,
      saveFailed: 'Failed to save shortcut.',
      conflictOpen: 'Open Prompter cannot use the same shortcut as the import commands.',
      conflictWithOpen: (label: string) => `${label} conflicts with Open Prompter.`
    },
    host: {
      viewAction: 'View',
      reloadAction: 'Reload',
      notifications: {
        reloadAfterInstallOrUpgrade: 'Prompter was installed or updated. Reload the window to finish enabling the extension.',
        promptAutoCompleted: (title: string) => `Prompt auto-completed: ${title}...`,
        promptCompleted: (title: string) => `Prompt completed: ${title}...`,
        promptPaused: (title: string) => `Prompt paused: ${title}...`,
        promptCompletedGeneric: 'Prompt completed',
        newRunningPrompt: (title: string) => `New running prompt detected: ${title}...`
      },
      confirmations: {
        clearCacheMessage: 'Clear the Prompter cache? This removes cached prompt data and imported state from the current workspace.',
        clearCacheConfirm: 'Clear Cache',
        cancel: 'Cancel'
      },
      errors: {
        openPanelFailed: 'Prompter: failed to open the panel. Check the output panel for details.',
        importSelectionFailed: 'Prompter: failed to import the selection. Check the output panel for details.',
        activateFailed: 'Prompter failed to activate. Check the "Output" panel → Prompter for details.',
        activateFailedRecovery: 'Prompter failed to activate. Open Settings, run "Clear Cache", and then restart Cursor/VS Code.',
        jumpToSourceFailed: (sourceType: string) => `Unable to jump to the ${sourceType} session`,
        shortcutUnavailable: 'Shortcut updates are unavailable in this panel',
        shortcutRollbackFailed: (message?: string) =>
          message ? `Failed to roll back Prompter shortcuts: ${message}` : 'Failed to roll back Prompter shortcuts',
        shortcutApplyFailed: (message?: string) => message ?? 'Failed to apply Prompter shortcuts'
      }
    }
  }
} as const;

export function getLocaleText(language: Locale) {
  return text[language] ?? text['zh-CN'];
}

export function getShortcutLabel(command: PrompterCommandId, language: Locale): string {
  return shortcutLabels[language]?.[command] ?? shortcutLabels.en[command];
}
