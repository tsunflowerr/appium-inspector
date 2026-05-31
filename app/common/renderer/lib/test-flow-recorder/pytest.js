import {normalizeTestFlowStepDelayMs} from './common.js';

const APPIUM_BY_MAP = {
  id: 'AppiumBy.ID',
  xpath: 'AppiumBy.XPATH',
  name: 'AppiumBy.NAME',
  'class name': 'AppiumBy.CLASS_NAME',
  'accessibility id': 'AppiumBy.ACCESSIBILITY_ID',
  'css selector': 'AppiumBy.CSS_SELECTOR',
  'link text': 'AppiumBy.LINK_TEXT',
  'partial link text': 'AppiumBy.PARTIAL_LINK_TEXT',
  'tag name': 'AppiumBy.TAG_NAME',
  '-ios predicate string': 'AppiumBy.IOS_PREDICATE',
  '-ios class chain': 'AppiumBy.IOS_CLASS_CHAIN',
  '-android uiautomator': 'AppiumBy.ANDROID_UIAUTOMATOR',
  '-android datamatcher': 'AppiumBy.ANDROID_DATA_MATCHER',
  '-android viewtag': 'AppiumBy.ANDROID_VIEWTAG',
};

export function getPytestTestFlowCode({serverUrl, sessionCaps, steps = [], stepDelayMs}) {
  const resolvedServerUrl = serverUrl || 'http://127.0.0.1:4723';
  const normalizedStepDelayMs = normalizeTestFlowStepDelayMs(stepDelayMs);
  const shouldImportWaitHelpers = normalizedStepDelayMs > 0 && hasLocatorBasedSteps(steps);
  const stepLines = steps.length
    ? getStepSequenceLines(steps, 2, normalizedStepDelayMs, true)
    : ['        # Start recording to generate a flow here'];

  return [
    ...(shouldImportTime ? ['import time'] : []),
    'import pytest',
    'from appium import webdriver',
    'from appium.options.common import AppiumOptions',
    'from appium.webdriver.common.appiumby import AppiumBy',
    'from selenium.webdriver.common.action_chains import ActionChains',
    'from selenium.webdriver.common.actions import interaction',
    'from selenium.webdriver.common.actions.action_builder import ActionBuilder',
    'from selenium.webdriver.common.actions.pointer_input import PointerInput',
    ...(shouldImportWaitHelpers
      ? [
          'from selenium.common.exceptions import TimeoutException',
          'from selenium.webdriver.support import expected_conditions as EC',
          'from selenium.webdriver.support.ui import WebDriverWait',
        ]
      : []),
    '',
    '',
    'def create_driver():',
    '    options = AppiumOptions()',
    `    options.load_capabilities(${toPythonLiteral(sessionCaps || {}, 1)})`,
    `    return webdriver.Remote(${toPythonLiteral(resolvedServerUrl)}, options=options)`,
    ...(shouldImportWaitHelpers
      ? [
          '',
          '',
          'def is_present(driver, locator, timeout):',
          '    try:',
          '        WebDriverWait(driver, timeout).until(EC.presence_of_element_located(locator))',
          '        return True',
          '    except TimeoutException:',
          '        return False',
          '',
          '',
          'def is_visible(driver, locator, timeout):',
          '    try:',
          '        WebDriverWait(driver, timeout).until(EC.visibility_of_element_located(locator))',
          '        return True',
          '    except TimeoutException:',
          '        return False',
        ]
      : []),
    '',
    '',
    '@pytest.mark.smoke',
    'def test_recorded_flow():',
    '    driver = create_driver()',
    '    try:',
    ...stepLines,
    '    finally:',
    '        driver.quit()',
    '',
  ].join('\n');
}

function toPythonLiteral(value, indentLevel = 0) {
  const indent = ' '.repeat(indentLevel * 4);
  const nextIndent = ' '.repeat((indentLevel + 1) * 4);

  if (value === null || value === undefined) {
    return 'None';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return '[]';
    }

    return (
      `[` +
      `\n${value.map((item) => `${nextIndent}${toPythonLiteral(item, indentLevel + 1)}`).join(',\n')}` +
      `\n${indent}]`
    );
  }

  const entries = Object.entries(value);
  if (!entries.length) {
    return '{}';
  }

  return (
    `{` +
    `\n${entries
      .map(
        ([key, itemValue]) =>
          `${nextIndent}${JSON.stringify(key)}: ${toPythonLiteral(itemValue, indentLevel + 1)}`,
      )
      .join(',\n')}` +
    `\n${indent}}`
  );
}

function getLocatorBy(locator) {
  return APPIUM_BY_MAP[locator?.strategy] || 'AppiumBy.XPATH';
}

function getLocatorTuple(locator) {
  if (!locator?.strategy || !locator?.value) {
    return null;
  }

  return `(${getLocatorBy(locator)}, ${toPythonLiteral(locator.value)})`;
}

function getFindExpression(locator, plural = false) {
  if (!locator?.strategy || !locator?.value) {
    return null;
  }

  const by = getLocatorBy(locator);
  const command = plural ? 'find_elements' : 'find_element';
  return `driver.${command}(${by}, ${toPythonLiteral(locator.value)})`;
}

function withIndent(lines, indentLevel) {
  const indent = ' '.repeat(indentLevel * 4);
  return lines.map((line) => `${indent}${line}`);
}

function formatTimeoutSeconds(stepDelayMs) {
  const seconds = (stepDelayMs / 1000).toFixed(3);
  return seconds.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function hasLocatorBasedSteps(steps = []) {
  return steps.some((step) => {
    const hasOwnLocator = Boolean(step.locator?.strategy && step.locator?.value);
    const hasBranchLocator = Boolean(
      step.condition?.locator?.strategy && step.condition?.locator?.value,
    );
    return (
      hasOwnLocator ||
      hasBranchLocator ||
      hasLocatorBasedSteps(step.thenSteps || []) ||
      hasLocatorBasedSteps(step.elseSteps || [])
    );
  });
}

function getStepSequenceLines(steps, indentLevel, stepDelayMs, includeHeaders = false) {
  return steps.flatMap((step, index) => {
    const lines = [];

    if (includeHeaders) {
      lines.push(
        ...withIndent([`# [Step ${index + 1}] ${step.name || step.type || 'Step'}`], indentLevel),
      );
    }

    lines.push(...getStepLines(step, indentLevel, stepDelayMs));

    if (stepDelayMs > 0 && index < steps.length - 1) {
      lines.push(...withIndent([`time.sleep(${formatDelaySeconds(stepDelayMs)})`], indentLevel));
    }

    return lines;
  });
}

function getScrollRatios(direction = 'down') {
  switch (direction) {
    case 'up':
      return {
        startX: 0.5,
        startY: 0.3,
        endX: 0.5,
        endY: 0.75,
      };

    case 'left':
      return {
        startX: 0.25,
        startY: 0.5,
        endX: 0.8,
        endY: 0.5,
      };

    case 'right':
      return {
        startX: 0.8,
        startY: 0.5,
        endX: 0.25,
        endY: 0.5,
      };

    case 'down':
    default:
      return {
        startX: 0.5,
        startY: 0.75,
        endX: 0.5,
        endY: 0.3,
      };
  }
}

function getVisibleElementExpression(locator, stepDelayMs) {
  const findExpression = getFindExpression(locator);
  if (!findExpression) {
    return null;
  }

  if (stepDelayMs <= 0) {
    return findExpression;
  }

  const locatorTuple = getLocatorTuple(locator);
  return `WebDriverWait(driver, ${formatTimeoutSeconds(stepDelayMs)}).until(EC.visibility_of_element_located(${locatorTuple}))`;
}

function getPresenceExpression(locator, stepDelayMs) {
  const pluralFindExpression = getFindExpression(locator, true);
  if (!pluralFindExpression) {
    return null;
  }

  if (stepDelayMs <= 0) {
    return pluralFindExpression;
  }

  const locatorTuple = getLocatorTuple(locator);
  return `WebDriverWait(driver, ${formatTimeoutSeconds(stepDelayMs)}).until(EC.presence_of_element_located(${locatorTuple}))`;
}

function getActionLines(step, indentLevel, stepDelayMs) {
  if (step.action === 'scrollViewport') {
    const ratios = getScrollRatios(step.direction);
    return withIndent(
      [
        'window_rect = driver.get_window_rect()',
        `start_x = int(window_rect["width"] * ${ratios.startX})`,
        `start_y = int(window_rect["height"] * ${ratios.startY})`,
        `end_x = int(window_rect["width"] * ${ratios.endX})`,
        `end_y = int(window_rect["height"] * ${ratios.endY})`,
        'actions = ActionChains(driver)',
        'actions.w3c_actions = ActionBuilder(driver, mouse=PointerInput(interaction.POINTER_TOUCH, "touch"))',
        'actions.w3c_actions.pointer_action.move_to_location(start_x, start_y)',
        'actions.w3c_actions.pointer_action.pointer_down()',
        'actions.w3c_actions.pointer_action.pause(0.2)',
        'actions.w3c_actions.pointer_action.move_to_location(end_x, end_y)',
        'actions.w3c_actions.pointer_action.release()',
        'actions.perform()',
      ],
      indentLevel,
    );
  }

  if (step.action === 'back' || step.action === 'pressBack') {
    return withIndent(['driver.back()'], indentLevel);
  }

  if (step.action === 'pressHome') {
    return withIndent(
      ['driver.execute_script("mobile: pressButton", {"name": "home"})'],
      indentLevel,
    );
  }

  if (step.action === 'openAppSwitcher') {
    return withIndent(['driver.execute_script("mobile: pressKey", {"keycode": 187})'], indentLevel);
  }

  const visibleElementExpression = getVisibleElementExpression(step.locator, stepDelayMs);
  if (!visibleElementExpression) {
    return withIndent(
      [`# TODO: add a locator for this ${step.action || 'custom'} step`],
      indentLevel,
    );
  }

  switch (step.action) {
    case 'tap':
      return withIndent([`element = ${visibleElementExpression}`, 'element.click()'], indentLevel);

    case 'sendKeys':
      return withIndent(
        [
          `element = ${visibleElementExpression}`,
          `element.send_keys(${toPythonLiteral(step.value || '')})`,
        ],
        indentLevel,
      );

    case 'clear':
      return withIndent([`element = ${visibleElementExpression}`, 'element.clear()'], indentLevel);

    default:
      return withIndent(
        [`# TODO: implement recorded action '${step.action || 'custom'}'`],
        indentLevel,
      );
  }
}

function getAssertionLines(step, indentLevel, stepDelayMs) {
  const visibleElementExpression = getVisibleElementExpression(step.locator, stepDelayMs);
  const presenceExpression = getPresenceExpression(step.locator, stepDelayMs);

  if (!visibleElementExpression && !presenceExpression) {
    return withIndent(['# TODO: add a locator for this assertion'], indentLevel);
  }

  switch (step.assertion) {
    case 'exists':
      return withIndent([`assert ${presenceExpression}, "Expected element to exist"`], indentLevel);

    case 'visible':
      return withIndent(
        [`assert ${visibleElementExpression}.is_displayed(), "Expected element to be visible"`],
        indentLevel,
      );

    case 'enabled':
      return withIndent(
        [`assert ${visibleElementExpression}.is_enabled(), "Expected element to be enabled"`],
        indentLevel,
      );

    case 'disabled':
      return withIndent(
        [`assert not ${visibleElementExpression}.is_enabled(), "Expected element to be disabled"`],
        indentLevel,
      );

    case 'textEquals':
      return withIndent(
        [
          `assert ${visibleElementExpression}.text == ${toPythonLiteral(step.expectedText || '')}, "Expected element text to match"`,
        ],
        indentLevel,
      );

    case 'attributeEquals':
      return withIndent(
        [
          `assert ${visibleElementExpression}.get_attribute(${toPythonLiteral(step.attributeName || '')}) == ${toPythonLiteral(step.expectedValue || '')}, "Expected attribute value to match"`,
        ],
        indentLevel,
      );

    default:
      return withIndent(
        [`# TODO: implement assertion '${step.assertion || 'exists'}'`],
        indentLevel,
      );
  }
}

function getBranchLines(step, indentLevel, stepDelayMs) {
  const conditionLocator = step.condition?.locator || step.locator;
  const conditionType = step.condition?.assertion || 'exists';
  const locatorTuple = getLocatorTuple(conditionLocator);
  const conditionExpression = getPresenceExpression(conditionLocator, stepDelayMs);
  const singleConditionExpression = getVisibleElementExpression(conditionLocator, stepDelayMs);

  if (!locatorTuple || !conditionExpression || !singleConditionExpression) {
    return withIndent(['# TODO: define a supported branch condition'], indentLevel);
  }

  let conditionLine;
  if (conditionType === 'exists') {
    conditionLine =
      stepDelayMs > 0
        ? `if is_present(driver, ${locatorTuple}, ${formatTimeoutSeconds(stepDelayMs)}):`
        : `if ${conditionExpression}:`;
  } else if (conditionType === 'visible') {
    conditionLine =
      stepDelayMs > 0
        ? `if is_visible(driver, ${locatorTuple}, ${formatTimeoutSeconds(stepDelayMs)}):`
        : `if ${singleConditionExpression}.is_displayed():`;
  } else {
    return withIndent(['# TODO: define a supported branch condition'], indentLevel);
  }

  const lines = withIndent([conditionLine], indentLevel);
  const thenSteps = step.thenSteps?.length ? step.thenSteps : [{type: 'action', action: 'custom'}];
  const elseSteps = step.elseSteps?.length ? step.elseSteps : [{type: 'action', action: 'custom'}];

  lines.push(...getStepSequenceLines(thenSteps, indentLevel + 1, stepDelayMs));

  lines.push(...withIndent(['else:'], indentLevel));
  lines.push(...getStepSequenceLines(elseSteps, indentLevel + 1, stepDelayMs));

  return lines;
}

function getStepLines(step, indentLevel = 2, stepDelayMs = 0) {
  if (step.type === 'assertion') {
    return getAssertionLines(step, indentLevel, stepDelayMs);
  }

  if (step.type === 'branch') {
    return getBranchLines(step, indentLevel, stepDelayMs);
  }

  return getActionLines(step, indentLevel, stepDelayMs);
}
