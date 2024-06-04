import { Coroutine } from '@bablr/coroutine';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { reifyExpression } from '@bablr/agast-vm-helpers';
import emptyStack from '@iter-tools/imm-stack';
import ansiStyles from 'ansi-styles';

export const evaluate = (strategy) => new StreamIterable(__evaluate(strategy));

const __evaluate = function* evaluateAnsi(strategy) {
  let stack = emptyStack;

  const co = new Coroutine(getStreamIterator(strategy()));

  co.advance();

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = yield co.current;
    }

    if (co.done) break;

    const sourceInstr = co.value;
    const instr = reifyExpression(sourceInstr);
    let returnValue = undefined;

    const { verb, arguments: args } = instr;

    switch (verb) {
      case 'write': {
        yield* args[0];
        break;
      }

      case 'push': {
        stack = stack.push({
          spans: args,
        });

        // TODO is this safe? Probably not.
        // Who knows what is on the ansiStyles prototype chain...
        yield* args.map((id) => ansiStyles[id].open).join('');

        break;
      }

      case 'pop': {
        if (!stack.size) throw new Error('cannot pop: stack empty');

        const frame = stack.value;

        stack = stack.pop();

        yield* frame.spans
          .map((id) => ansiStyles[id].close)
          .reverse()
          .join('');

        break;
      }

      default: {
        throw new Error(`Unexpected call of {type: ${printExpression(verb)}}`);
      }
    }

    co.advance(returnValue);
  }

  if (stack.size) throw new Error();
};
