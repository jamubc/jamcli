import { useLayoutContext } from './useLayoutContext.js';
import { useLayoutEffects } from './useLayoutEffects.js';
import { useLayoutPanels } from './useLayoutPanels.js';
import { useLayoutDerived } from './useLayoutDerived.js';
import { useLayoutActions } from './useLayoutActions.js';
import { LayoutView } from './LayoutView.js';

export const Layout = () => {
  const ctx = useLayoutContext();

  useLayoutEffects(ctx);
  const panels = useLayoutPanels(ctx);
  const derived = useLayoutDerived(ctx, panels.suggestions);
  const actions = useLayoutActions(ctx, derived, panels);

  return <LayoutView ctx={ctx} derived={derived} panels={panels} actions={actions} />;
};
