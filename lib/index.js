/* global process */

import { Coroutine } from '@bablr/coroutine';
import { getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { getEmbeddedExpression } from '@bablr/agast-vm-helpers/deembed';
import emptyStack from '@iter-tools/imm-stack';
import ansiStyles_ from 'ansi-styles';

const ansiStyles = {
  ...ansiStyles_,
  orange: {
    open: ansiStyles_.color.ansi256(208),
    close: ansiStyles_.color.close,
  },
};

export const writeLinesToWritableStream = async (from, to) => {
  const co = new Coroutine(getStreamIterator(from));

  let buf = '';

  for (;;) {
    co.advance();

    if (co.current instanceof Promise) {
      co.current = await co.current;
    }

    if (co.done) break;

    const chr = co.value;

    buf += chr;

    if (chr === '\n') {
      if (!to.write(buf)) {
        await to.once('drain');
      }
      buf = '';
    }
  }

  if (!to.write(buf)) {
    await to.once('drain');
  }
};

export const evaluateIO = async (strategy) => {
  let stack = emptyStack;

  const co = new Coroutine(getStreamIterator(strategy()));

  co.advance();

  const streams = [process.stdout, process.stderr];

  let activeStream;

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = await co.current;
    }

    if (co.done) break;

    const instr = co.value;
    let returnValue = undefined;

    if (instr.type !== 'Effect') throw new Error();

    const effect = getEmbeddedExpression(instr.value);

    const { verb, value } = effect;

    switch (verb) {
      case 'write': {
        let { text, options: embeddedOptions } = getEmbeddedExpression(value);

        const options = getEmbeddedExpression(embeddedOptions);

        const { stream: streamNo = 1 } = options;

        if (streamNo !== 1 && streamNo !== 2) throw new Error();

        if (text.includes('\u001B')) {
          throw new Error('Cannot write ANSI escape to io VM, instead use ansi-push');
        }

        const prevActiveStream = activeStream;

        activeStream = streams[streamNo - 1];

        if (prevActiveStream && activeStream !== prevActiveStream && !text.startsWith('\n')) {
          text = `\n${text}`;
        }

        writeLinesToWritableStream(text, activeStream);
        break;
      }

      case 'ansi-push': {
        let { spans } = getEmbeddedExpression(value);

        if (!spans?.length) {
          spans = stack.value?.spans || [];
        }

        if (stack.value?.spans.length) {
          writeLinesToWritableStream(
            stack.value.spans
              .map((id) => ansiStyles[id].close)
              .reverse()
              .join(''),
            process.stdout,
          );
        }

        stack = stack.push({
          spans,
        });

        if (spans.length) {
          // TODO is this safe? Probably not.
          // Who knows what is on the ansiStyles prototype chain...
          writeLinesToWritableStream(
            stack.value.spans.map((id) => ansiStyles[id].open).join(''),
            process.stdout,
          );
        }
        break;
      }

      case 'ansi-pop': {
        if (!stack.size) throw new Error('cannot pop: stack empty');

        const stackValue = stack.value;

        stack = stack.pop();

        if (stackValue.spans.length) {
          writeLinesToWritableStream(
            stackValue.spans
              .map((id) => ansiStyles[id].close)
              .reverse()
              .join(''),
            process.stdout,
          );
        }

        if (stack.value && stack.value.spans.length) {
          writeLinesToWritableStream(
            stack.value.spans.map((id) => ansiStyles[id].open).join(''),
            process.stdout,
          );
        }
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
