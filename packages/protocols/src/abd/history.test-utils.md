# ABD history checker test contract

The bounded checker is a completed-operation safety oracle. Test histories must include invocation/completion sequence positions and returned tags.

Required positive case: an overlapping read may linearize before an overlapping write and return the prior tag.

Required negative case: a read that starts after a completed write and returns an older tag is non-linearizable.

The checker intentionally does not judge incomplete operations.
