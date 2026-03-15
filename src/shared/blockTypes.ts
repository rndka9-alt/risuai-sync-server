/**
 * RisuSave 블록 타입 상수 & 동기화 상수.
 * 서버 + 클라이언트 공통 모듈.
 *
 * RisuAI의 RisuSaveType enum과 동기화 필요:
 * - 0: CONFIG          – 설정 데이터
 * - 1: ROOT            – 최상위 DB 블록 (__directory, enabledModules 등)
 * - 2: WITH_CHAT       – 캐릭터 카드 (채팅 포함)
 * - 3: CHAT            – 채팅 (미사용)
 * - 4: BOTPRESET       – 봇 프리셋
 * - 5: MODULES         – 모듈
 * - 6: REMOTE          – 원격 블록 (메타데이터만)
 * - 7: WITHOUT_CHAT    – 캐릭터 카드 (채팅 미포함)
 * - 8: ROOT_COMPONENT  – ROOT 분할 컴포넌트
 */
export const BLOCK_TYPE = {
  CONFIG: 0,
  ROOT: 1,
  WITH_CHAT: 2,
  CHAT: 3,
  BOTPRESET: 4,
  MODULES: 5,
  REMOTE: 6,
  WITHOUT_CHAT: 7,
  ROOT_COMPONENT: 8,
} as const;

export type BlockType = (typeof BLOCK_TYPE)[keyof typeof BLOCK_TYPE];

const BLOCK_TYPE_VALUES: ReadonlySet<number> = new Set(Object.values(BLOCK_TYPE));

export function isBlockType(value: number): value is BlockType {
  return BLOCK_TYPE_VALUES.has(value);
}

/**
 * ROOT 키 3분류:
 * - SYNCED  – broadcast O, 클라이언트 live-apply (팝업 없음)
 * - IGNORED – broadcast X (echo loop 차단)
 * - 미분류  – broadcast O, 클라이언트 reload 팝업 (신규 키 안전장치)
 */

/** 동기화 대상 ROOT 키 (allow-list). 변경 시 broadcast → 클라이언트 live-apply */
export const SYNCED_ROOT_KEYS: ReadonlySet<string> = new Set([
  // AI 모델 & 파라미터
  'apiType', 'aiModel', 'subModel', 'temperature', 'maxContext', 'maxResponse',
  'frequencyPenalty', 'PresensePenalty', 'top_p', 'top_k', 'repetition_penalty',
  'min_p', 'top_a', 'generationSeed', 'bias', 'useStreaming',
  'thinkingTokens', 'thinkingType', 'adaptiveThinkingEffort', 'reasoningEffort', 'verbosity',

  // 프롬프트
  'mainPrompt', 'jailbreak', 'globalNote', 'jailbreakToggle', 'formatingOrder',
  'additionalPrompt', 'descriptionPrefix', 'emotionPrompt', 'emotionPrompt2',
  'emotionProcesser', 'promptTemplate', 'promptSettings', 'customPromptTemplateToggle',
  'templateDefaultVariables', 'supaMemoryPrompt', 'igpPrompt',
  'systemContentReplacement', 'systemRoleReplacement', 'OAIPrediction',

  // API 키 / 인증
  'openAIKey', 'proxyKey', 'claudeAPIKey', 'NAIApiKey', 'huggingfaceKey',
  'mistralKey', 'cohereAPIKey', 'openrouterKey', 'supaMemoryKey', 'hypaMemoryKey',
  'mancerHeader', 'stabilityKey', 'falToken', 'google', 'OaiCompAPIKeys',
  'vertexPrivateKey', 'vertexClientEmail', 'vertexAccessToken',
  'vertexAccessTokenExpires', 'vertexRegion', 'novelai', 'authRefreshes',

  // URL 설정
  'forceReplaceUrl', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL',
  'koboldURL', 'keiServerURL', 'ollamaURL', 'ollamaModel', 'comfyUiUrl',
  'voicevoxUrl', 'webUiUrl', 'NAIImgUrl',

  // 기능 토글 & 모듈
  'enabledModules', 'modules', 'moduleIntergration',
  'swipe', 'chainOfThought', 'jsonSchemaEnabled', 'jsonSchema',
  'strictJsonSchema', 'extractJson', 'autoContinueChat', 'autoContinueMinTokens',
  'removeIncompleteResponse', 'useAutoSuggestions', 'autoSuggestPrompt',
  'autoSuggestPrefix', 'autoSuggestClean', 'promptPreprocess', 'hypaMemory',
  'hypav2', 'memoryAlgorithmType', 'claudeCachingExperimental', 'claudeBatching',
  'claude1HourCaching', 'claudeRetrivalCaching', 'automaticCachePoint',
  'antiClaudeOverload', 'antiServerOverloads', 'chatCompression',
  'rememberToolUsage', 'simplifiedToolUse', 'hanuraiEnable', 'hanuraiTokens',
  'hanuraiSplit', 'enableRemoteSaving',

  // 유저 / 페르소나
  'username', 'userIcon', 'userNote', 'personas', 'selectedPersona',
  'personaPrompt', 'personaNote',

  // 로어북
  'loreBook', 'loreBookDepth', 'loreBookToken', 'loreBookPage',
  'localActivationInGlobalLorebook',

  // 번역
  'translator', 'translatorType', 'translatorInputLanguage', 'translatorPrompt',
  'translatorMaxResponse', 'autoTranslate', 'useAutoTranslateInput',
  'htmlTranslation', 'legacyTranslation', 'deeplOptions', 'deeplXOptions',
  'combineTranslation', 'noWaitForTranslate', 'translateBeforeHTMLFormatting',
  'autoTranslateCachedOnly', 'sourcemapTranslate',

  // 프리셋 & 모델 설정
  'botPresetsId', 'presetChain', 'presetRegex',
  'seperateParametersEnabled', 'seperateParameters',
  'seperateModelsForAxModels', 'seperateModels',
  'customModels', 'customFlags', 'enableCustomFlags',
  'fallbackModels', 'fallbackWhenBlankResponse',
  'modelTools', 'openrouterProvider', 'openrouterRequestModel',
  'openrouterMiddleOut', 'openrouterFallback',
  'customAPIFormat', 'proxyRequestModel', 'customProxyRequestModel',
  'forceProxyAsOpenAI', 'reverseProxyOobaMode', 'reverseProxyOobaArgs',
  'useInstructPrompt', 'claudeAws', 'customTokenizer', 'instructChatTemplate',
  'JinjaTemplate', 'requestLocation',

  // 이미지 생성
  'sdProvider', 'sdSteps', 'sdCFG', 'sdConfig', 'NAIImgModel', 'NAII2I', 'NAIREF',
  'NAIImgConfig', 'dallEQuality', 'stabilityModel', 'stabllityStyle',
  'comfyConfig', 'falModel', 'falLora', 'falLoraName', 'falLoraScale',
  'ImagenModel', 'ImagenImageSize', 'ImagenAspectRatio', 'ImagenPersonGeneration',
  'openaiCompatImage', 'wavespeedImage', 'gptVisionQuality',

  // 캐릭터 관리 & 기타
  'characterOrder', 'globalscript', 'plugins', 'pluginV2',
  'currentPluginProvider', 'pluginCustomStorage',
  'globalChatVariables', 'localStopStrings', 'additionalParams',
  'NAIsettings', 'ooba', 'ainconfig', 'hordeConfig',
  'requestRetrys', 'imageCompression', 'cipherChat',
  'hypaModel', 'hypaV3', 'hypaV3Settings', 'hypaV3Presets', 'hypaV3PresetId',
  'hypaAllocatedTokens', 'hypaChunkSize', 'maxSupaChunkSize',
  'removePunctuationHypa', 'memoryLimitThickness', 'supaModelType',
  'hypaCustomSettings', 'dynamicOutput',
  'newOAIHandle', 'useSayNothing', 'instantRemove',
  'banCharacterset', 'useTokenizerCaching',
  'googleClaudeTokenizing', 'geminiStream', 'streamGeminiThoughts',
  'dynamicAssets', 'askRemoval',
  'groupTemplate', 'groupOtherBotRole',
  'customQuotes', 'customQuotesData',
]);

/** per-device ROOT 키 (deny-list). 변경 시 broadcast 하지 않음 */
export const IGNORED_ROOT_KEYS: ReadonlySet<string> = new Set([
  // 타임스탬프 / 내부상태
  'saveTime', 'genTime', 'formatversion', 'didFirstSetup',
  'lastPatchNoteCheckVersion', 'statics', 'account',

  // UI / 레이아웃
  'zoomsize', 'iconsize', 'fullScreen', 'textAreaSize', 'sideBarSize',
  'textAreaTextSize', 'waifuWidth', 'waifuWidth2', 'assetWidth', 'heightMode',
  'classicMaxWidth', 'betaMobileGUI', 'useLegacyGUI', 'menuSideBar',
  'animationSpeed', 'roundIcons', 'settingsCloseButtonSize',
  'hamburgerButtonBottom', 'enableScrollToActiveChar',

  // 테마 / 비주얼
  'theme', 'textTheme', 'customTextTheme', 'colorScheme', 'colorSchemeName',
  'customBackground', 'textScreenColor', 'textScreenBorder', 'textScreenRounded',
  'textBorder', 'customCSS', 'customGUI', 'guiHTML',
  'font', 'customFont', 'lineHeight', 'blockquoteStyling', 'unformatQuotes',

  // 로케일
  'language',

  // per-device UI 토글
  'hotkeys', 'notification', 'showMenuChatList', 'showMenuHypaMemoryModal',
  'sideMenuRerollButton', 'requestInfoInsideChat', 'promptInfoInsideChat',
  'promptTextInfoInsideChat', 'showSavingIcon', 'showPromptComparison',
  'showTranslationLoading', 'showDeprecatedTriggerV1', 'showDeprecatedTriggerV2',
  'returnCSSError', 'hideApiKey', 'enableDevTools', 'inlayErrorResponse',
  'hideRealm', 'showFirstMessagePages', 'showFolderName',
  'enableBookmark', 'hideAllImages', 'autoScrollToNewMessage',
  'alwaysScrollToNewMessage', 'newMessageButtonStyle', 'showUnrecommended',
  'pluginDevelopMode', 'outputImageModal', 'dynamicAssetsEditDisplay',
  'auxModelUnderModelSettings', 'sendWithEnter', 'fixedChatTextarea',
  'clickToEdit', 'enableBlockPartialEdit', 'enableDragPartialEdit',
  'useChatSticker', 'useAdditionalAssetsPreview', 'botSettingAtStart',
  'showMemoryLimit', 'promptDiffPrefs', 'createFolderOnBranch',
  'useChatCopy', 'playMessage', 'ttsAutoSpeech', 'playMessageOnTranslateEnd',
  'goCharacterOnImport', 'bulkEnabling', 'realmDirectOpen',
  'lightningRealmImport', 'allowAllExtentionFiles', 'newImageHandlingBeta',
  'legacyMediaFindings', 'assetMaxDifference', 'hubServerType',
  'autofillRequestUrl', 'checkCorruption', 'saveSignatures',
  'echoMessage', 'echoDelay', 'NAIadventure', 'NAIappendName',
  'dynamicModelRegistry', 'enableRisuaiProTools', 'epEnabled',
  'seperateParametersByModel', 'disableSeperateParameterChangeOnPresetChange',
  'toggleConfirmRecommendedPreset', 'doNotChangeSeperateModels',
  'doNotChangeFallbackModels', 'useExperimental', 'useExperimentalGoogleTranslator',
  'usePlainFetch', 'novellistAPI', 'elevenLabKey', 'fishSpeechKey',
  'showFolderName', 'chatCompression',
]);

export function isSyncedRootKey(key: string): boolean {
  return SYNCED_ROOT_KEYS.has(key);
}

export function isIgnoredRootKey(key: string): boolean {
  return IGNORED_ROOT_KEYS.has(key);
}

// 하위호환: SAFE_ROOT_KEYS = SYNCED_ROOT_KEYS
export const SAFE_ROOT_KEYS = SYNCED_ROOT_KEYS;

export function isSafeRootKey(key: string): boolean {
  return SYNCED_ROOT_KEYS.has(key);
}
