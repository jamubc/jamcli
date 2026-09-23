import { Box, Text } from 'ink';
import { Header } from './Header.js';
import { ChatViewport } from './ChatViewport.js';
import { InputBar } from './InputBar.js';
import { ActionModal } from './ActionModal.js';
import { ModelSelectorModal } from './ModelSelectorModal.js';
import { ModelDetailsModal } from './ModelDetailsModal.js';
import { SessionSelectorModal } from './SessionSelectorModal.js';
import { ConfigMenuScreen } from './ConfigMenuScreen.js';
import { ProviderConfigModal } from './ProviderConfigModal.js';
import { McpServerModal } from './McpServerModal.js';
import { CONFIGURE_ENTRY_ID } from './layoutState.js';
import type { LayoutContext } from './useLayoutContext.js';
import type { LayoutDerived } from './useLayoutDerived.js';
import type { LayoutPanels } from './useLayoutPanels.js';
import type { LayoutActions } from './useLayoutActions.js';

export interface LayoutViewProps {
  ctx: LayoutContext;
  derived: LayoutDerived;
  panels: LayoutPanels;
  actions: LayoutActions;
}

export const LayoutView = (props: LayoutViewProps) => {
  const {
    configServiceRef,
    statusStyle,
    isExpandedView,
    modelMenuState,
    modelDetail,
    isConfigMenuOpen,
    config,
    uiConfig,
    statusStyleOptions,
    inputValue,
    selectedSuggestion,
    activeProfile,
    mcpServers,
    mcpTestResults,
    defaultMcpConfigPath,
    configWizard,
    sessionMenuState,
    pendingAction,
    messages,
    status,
    statusDetail,
    exitConfirmation,
    terminalSize,
    inlineNotice,
    setConfigWizard,
    setIsConfigMenuOpen,
  } = props.ctx;
  const configService = configServiceRef.current;

  const {
    layoutPaddingX,
    layoutPaddingY,
    layoutGap,
    headerMode,
    modelMenuReservedLines,
    filteredModelList,
    modelMenuWindowSize,
    displayCwd,
    currentModelName,
    collapsedPasteSummary,
    showSuggestions,
    isInputFocused,
  } = props.derived;

  const {
    handleStatusStyleSubmit,
    handleTextInputChange,
    closeConfigMenu,
    removeProvider,
    updateConfigWizardForm,
    cancelConfigWizard,
    handleConfigWizardSubmit,
    handleModelSearchChange,
    handleSessionSearch,
    changeSessionPage,
    updateToolModelFilterSetting,
    updateSystemPromptSetting,
    removeMcpServer,
    suggestions,
    suggestionHint,
  } = props.panels;

  const { menusActions, handleInputSubmit } = props.actions;
  const {
    isModelDetailOpen,
    safeModelMenuIndex,
    safeSessionMenuIndex,
    sessionTotalPages,
  } = menusActions;
  const {
    openAddMcpWizard,
    openEditMcpWizard,
    handleMcpWizardSubmit,
    handleTestMcpServer,
    handleTestAllMcpServers,
    copyMcpConfigPath,
    openMcpConfigFile,
  } = props.actions.mcpPanels;

  return (
    <Box flexDirection="column" paddingX={layoutPaddingX} paddingY={layoutPaddingY} gap={layoutGap}>
      <Header mode={headerMode} statusStyle={statusStyle} />
      <ChatViewport
        isExpanded={isExpandedView}
        reservedLineBoost={modelMenuReservedLines}
        status={status}
        statusDetail={statusDetail}
        statusStyle={statusStyle}
      />
      {modelMenuState.open && (
        <ModelSelectorModal
          visible={modelMenuState.open}
          models={filteredModelList}
          totalCount={modelMenuState.models.length}
          selectedIndex={safeModelMenuIndex}
          searchQuery={modelMenuState.searchQuery}
          onSearchChange={handleModelSearchChange}
          maxVisibleItems={modelMenuWindowSize}
          isSearchFocused={!isModelDetailOpen}
          configureEntryId={CONFIGURE_ENTRY_ID}
        />
      )}
      {modelMenuState.open && modelDetail && <ModelDetailsModal visible={true} model={modelDetail} />}
      {isConfigMenuOpen && config && (
        <ConfigMenuScreen
          visible={isConfigMenuOpen}
          config={config}
          uiConfig={uiConfig}
          currentStatusStyle={statusStyle}
          statusStyleOptions={statusStyleOptions}
          onClose={closeConfigMenu}
          onUpdateProvider={(provider) => {
            setIsConfigMenuOpen(false);
            setConfigWizard({
              mode: 'provider',
              provider,
              form: {
                endpoint: provider === 'ollama' ? config?.api_registry?.ollama?.endpoint || 'http://localhost:11434' : '',
                apiKey: '',
              },
            });
          }}
          onRemoveProvider={removeProvider}
          onSelectStatusStyle={(option, _index) => void handleStatusStyleSubmit(option)}
          onUpdateSystemPrompt={(prompt) => void updateSystemPromptSetting(prompt)}
          isCommandMode={inputValue.startsWith('/')}
          systemPrompt={activeProfile?.system_prompt_override}
          onToggleToolModelFilter={(enabled) => void updateToolModelFilterSetting(enabled)}
          mcpServers={mcpServers}
          mcpTestResults={mcpTestResults}
          mcpConfigPath={configService?.getMcpConfigPath() || defaultMcpConfigPath}
          onAddMcpServer={openAddMcpWizard}
          onEditMcpServer={openEditMcpWizard}
          onRemoveMcpServer={(server) => void removeMcpServer(server.id)}
          onTestMcpServer={handleTestMcpServer}
          onTestAllMcpServers={handleTestAllMcpServers}
          onCopyMcpConfigPath={copyMcpConfigPath}
          onOpenMcpConfig={openMcpConfigFile}
        />
      )}
      {configWizard?.mode === 'provider' && (
        <ProviderConfigModal
          visible={true}
          provider={configWizard.provider}
          value={
            configWizard.provider === 'ollama'
              ? configWizard.form.endpoint || ''
              : configWizard.form.apiKey || ''
          }
          onChange={(value) => {
            const field = configWizard.provider === 'ollama' ? 'endpoint' : 'apiKey';
            updateConfigWizardForm(field, value);
          }}
          onSubmit={handleConfigWizardSubmit}
          onCancel={cancelConfigWizard}
        />
      )}
      {configWizard?.mode === 'mcp' && (
        <McpServerModal
          visible={true}
          action={configWizard.action}
          server={configWizard.server}
          form={configWizard.form}
          onChange={(field, value) => updateConfigWizardForm(field, value)}
          onSubmit={handleMcpWizardSubmit}
          onCancel={cancelConfigWizard}
        />
      )}
      {sessionMenuState.open && (
        <SessionSelectorModal
          visible={sessionMenuState.open}
          sessions={sessionMenuState.sessions}
          selectedIndex={safeSessionMenuIndex}
          searchQuery={sessionMenuState.searchQuery}
          onSearchChange={handleSessionSearch}
          currentPage={sessionMenuState.currentPage}
          totalPages={sessionTotalPages}
          onPageChange={changeSessionPage}
        />
      )}
      {pendingAction && <ActionModal />}
      <Box flexDirection="column" gap={0}>
        {isExpandedView && messages.length > 0 && (
          <Box marginBottom={0} paddingBottom={0} paddingTop={0} marginTop={0}>
            <Text color="cyan">Expanded mode. Press Ctrl+R to return to compact view.</Text>
          </Box>
        )}
        <InputBar
          value={inputValue}
          status={status}
          statusDetail={statusDetail}
          showStatusCard={false}
          onChange={handleTextInputChange}
          onSubmit={handleInputSubmit}
          suggestions={suggestions}
          showSuggestions={showSuggestions}
          selectedSuggestion={selectedSuggestion}
          isFocused={isInputFocused}
          suggestionHint={suggestionHint || undefined}
          collapsedPasteSummary={collapsedPasteSummary}
          footer={
            exitConfirmation ? (
              <Text color="yellow">Press Ctrl+C again within 3s to exit JamCLI.</Text>
            ) : (() => {
              const PWD_MAX_LEN = 35;
              const MODEL_MAX_LEN = 30;
              const STATIC_BUFFER = 4; // InputBar padding plus spacing around the hint area
              const SECTION_GAP = 1;
              const MIN_HINT_RATIO = 0.5;
              const MIN_VISIBLE_HINT = 6;

              const pwdStr = displayCwd.length > PWD_MAX_LEN
                ? `...${displayCwd.slice(-(PWD_MAX_LEN - 3))}`
                : displayCwd;

              const modelStr = currentModelName.length > MODEL_MAX_LEN
                ? `${currentModelName.slice(0, MODEL_MAX_LEN - 3)}...`
                : currentModelName;

              const totalColumns = terminalSize.columns || 80;
              const availableForHints = Math.max(
                0,
                totalColumns - pwdStr.length - modelStr.length - STATIC_BUFFER
              );
              const hintSourceText = inlineNotice?.message || "Use /help · Ctrl+R toggles full view · Press Ctrl+C to exit";
              const hintLength = hintSourceText.length;
              const fullHintFits = availableForHints >= hintLength;
              const partialHintThreshold = Math.ceil(hintLength * MIN_HINT_RATIO);
              let hintStr = "";

              if (fullHintFits) {
                hintStr = hintSourceText;
              } else if (availableForHints >= Math.max(MIN_VISIBLE_HINT, partialHintThreshold)) {
                const ellipsis = '...';
                const sliceLength = Math.max(1, availableForHints - ellipsis.length);
                hintStr = `${hintSourceText.slice(0, sliceLength).trimEnd()}${ellipsis}`;
              }
              const hintColor = inlineNotice
                ? inlineNotice.tone === 'warning'
                  ? 'yellow'
                  : 'cyan'
                : 'gray';

              const pwdColor = 'cyan';

              return (
                <Box flexDirection="row" width="100%" alignItems="center">
                  <Box flexShrink={0} marginRight={SECTION_GAP}>
                    <Text color={pwdColor}>{pwdStr}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} justifyContent="center">
                    {hintStr ? <Text color={hintColor}>{hintStr}</Text> : <Text> </Text>}
                  </Box>
                  <Box flexShrink={0} marginLeft={SECTION_GAP}>
                    <Text color="gray">{modelStr}</Text>
                  </Box>
                </Box>
              );
            })()
          }
        />
      </Box>
    </Box>
  );
};
