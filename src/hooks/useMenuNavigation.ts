import { useInput } from 'ink';

export type PageDirection = 'prev' | 'next';

interface PagingControls {
  totalPages: number;
  onPageChange: (direction: PageDirection) => void;
}

interface MenuNavigationOptions {
  isOpen: boolean;
  totalItems: number;
  selectedIndex: number;
  onChangeIndex: (nextIndex: number) => void;
  onSubmit?: (index: number) => void;
  onClose?: () => void;
  wrap?: boolean;
  paging?: PagingControls;
}

export const useMenuNavigation = ({
  isOpen,
  totalItems,
  selectedIndex,
  onChangeIndex,
  onSubmit,
  onClose,
  wrap = true,
  paging,
}: MenuNavigationOptions) => {
  useInput((input, key) => {
    if (!isOpen) return;

    if (key.upArrow && totalItems > 0) {
      const nextIndex = wrap
        ? (selectedIndex - 1 + totalItems) % totalItems
        : Math.max(0, selectedIndex - 1);
      onChangeIndex(nextIndex);
      return;
    }

    if (key.downArrow && totalItems > 0) {
      const nextIndex = wrap
        ? (selectedIndex + 1) % totalItems
        : Math.min(totalItems - 1, selectedIndex + 1);
      onChangeIndex(nextIndex);
      return;
    }

    if (key.leftArrow && paging) {
      paging.onPageChange('prev');
      return;
    }

    if (key.rightArrow && paging) {
      paging.onPageChange('next');
      return;
    }

    if (key.return && totalItems > 0) {
      onSubmit?.(selectedIndex);
      return;
    }

    if (key.escape) {
      onClose?.();
    }
  }, { isActive: isOpen });
};
