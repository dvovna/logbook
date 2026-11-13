// The action_id of each button in the DM about a received receipt; its value
// is the receipt's ID.
export enum ReceiptActionId {
  AddDetails = 'receipt_add_details',
  Discard = 'receipt_discard',
  // The button of the DM about a rejected receipt.
  EditDetails = 'receipt_edit_details',
}
