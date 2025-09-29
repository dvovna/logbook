export class SeparatorComponent {
  public static getBlocks() {
    return [
      { type: 'section', text: { type: 'plain_text', text: ' ' } },
      { type: 'divider' },
    ];
  }
}
