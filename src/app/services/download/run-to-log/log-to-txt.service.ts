import { PartialOrder } from "src/app/classes/diagram/partial-order";
import { attributesAttribute, caseIdAttribute, conceptNameAttribute, eventIdAttribute, eventsAttribute, logTypeKey } from "../../parser/parsing-constants";

/**
   * Generates the displayed log text based on the log object.
   * @param partialOrders contains the uploaded (and modified) partial order objects
   * @returns the displayed log text
   */
export function generateTextFromLog(partialOrders: PartialOrder[]): string {
  let newText = `${logTypeKey}\n${attributesAttribute}\n${caseIdAttribute}\n${conceptNameAttribute}\n${eventsAttribute}\n`;

  let index = 0;
  partialOrders.forEach((row) => {
    index = index + 1;
    row.events.forEach((event) => {
      newText += `${index} ${event.label}\n`;
    });
  });

  return newText;
}