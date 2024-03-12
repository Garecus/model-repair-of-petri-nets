import { PartialOrder } from "src/app/classes/diagram/partial-order";
import { attributesAttribute, caseIdAttribute, conceptNameAttribute, eventIdAttribute, logTypeKey } from "../../parser/parsing-constants";

export function generateTextFromLog(partialOrders: PartialOrder[]): string {
  let newText = `${logTypeKey}\n${attributesAttribute}\n${caseIdAttribute}\n${conceptNameAttribute}\n${eventIdAttribute}\n`;

  let index = 0;
  partialOrders.forEach((row) => {
    index = index + 1;
    row.events.forEach((event) => {
      newText += `${index} ${event.label}\n`;
    });
  });

  return newText;
}