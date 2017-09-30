exports.startWithDelay = (engine) => {
  return new Promise((resolve) => {
    engine.start()
      .then(() => {
        setTimeout(resolve, 100);
      })
  });
};
