import '@opentui/react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      box: any;
      text: any;
      input: any;
      // Add others if needed
    }
  }
}
