import { parsedPartialOrders } from '../../upload/example-file-parsed';
import { generateTextFromLog } from './log-to-txt.service';

describe('logToText', () => {
  it('should parse example run to pnml', () => {
    const result = generateTextFromLog(parsedPartialOrders);

    expect(result).toEqual(parsedLogTxt);
  });
});

const parsedLogTxt =
  `.type log
.attributes
case-id
concept:name
.events
1 a
1 b
1 c
2 a
2 c
2 b
`;
