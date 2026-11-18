"""Helpers for the AI2AI book.

load() brings in the data and the pre-trained weights a
chapter uses, so the code on the slides can be about the
model and not about setting it up.
"""
import os
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))


def _find(file):
    for folder in (os.getcwd(), HERE):
        path = os.path.join(folder, file)
        if os.path.exists(path):
            return path
    return None


class Text:
    """A text as words, its vocabulary and the word ids."""

    def __init__(self, words):
        self.words = words
        self.vocab = list(dict.fromkeys(words))
        self.ids = torch.tensor(self.encode(words))

    def encode(self, words):
        if isinstance(words, str):
            words = words.split()
        return [self.vocab.index(w) for w in words]

    def decode(self, ids):
        return " ".join(self.vocab[int(i)] for i in ids)

    def __repr__(self):
        return (f"{len(self.words)} words, "
                f"{len(self.vocab)} different ones")


class Weights:
    """Named weight matrices: W.Q, W.E, ..."""

    def __init__(self, arrays):
        for name, a in arrays.items():
            t = torch.tensor(np.asarray(a, dtype=np.float32),
                             requires_grad=True)
            setattr(self, name, t)

    def params(self):
        return list(vars(self).values())

    def __repr__(self):
        return "\n".join(f"{n:3} {tuple(t.shape)}"
                         for n, t in vars(self).items())


def load(name, trained=True):
    """load("fight-song") -> Text
    load("tiny-gpt") -> Weights, trained=False: before training"""
    text = _find(name + ".txt")
    if text:
        with open(text) as f:
            return Text(f.read().split())
    file = name if trained else name + "-untrained"
    weights = _find(file + ".npz")
    if not weights:
        raise FileNotFoundError(f"{file}: run the cell that "
                                "downloads the data first")
    with np.load(weights) as z:
        return Weights({k: z[k] for k in z.files})
