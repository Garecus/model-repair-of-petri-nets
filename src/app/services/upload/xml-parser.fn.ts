import { X2jOptionsOptional, XMLParser } from 'fast-xml-parser';

/**
 * Start the process to get elements out of the xml string
 * @param xmlContent uploaded xml string
 * @returns parsed elements like transition, places, arcs to compute with it
 */
export function parseXml<T>(xmlContent: string): T {
  const options: X2jOptionsOptional = {
    attributeNamePrefix: '',
    ignoreAttributes: false,
    allowBooleanAttributes: true,
  };
  const parser = new XMLParser(options);

  return parser.parse(xmlContent);
}
