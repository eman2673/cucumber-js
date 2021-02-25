Feature: Running scenarios in parallel

  Scenario: invalid parallel assignment handler fails the test
    Given a file named "features/step_definitions/cucumber_steps.js" with:
      """
      const {Given, Then, setParallelCanAssign} = require('@cucumber/cucumber')
      const Promise = require('bluebird')
      setParallelCanAssign(() => false)
      Given(/^a step$/, function() { })
      """
    And a file named "features/a.feature" with:
      """
      Feature: slow
        Scenario: a
          Given a step

        Scenario: b
          Given a step
      """
    When I run cucumber-js with `--parallel 2`
    Then it fails

  Scenario: valid parallel assignment handler passes the test
    Given a file named "features/step_definitions/cucumber_steps.js" with:
      """
      const {Given, setParallelCanAssign} = require('@cucumber/cucumber')
      const Promise = require('bluebird')
      let flag = true
      setParallelCanAssign(() => true)
      Given(/^a step$/, function() { })
      """
    And a file named "features/a.feature" with:
      """
      Feature: slow
        Scenario: a
          Given a step

        Scenario: b
          Given a step
      """
    When I run cucumber-js with `--parallel 2`
    Then it passes

  Scenario: assignment is appropriately applied and fails processing scenario a last
    Given a file named "features/step_definitions/cucumber_steps.js" with:
      """
      const {Given, Then, setParallelCanAssign} = require('@cucumber/cucumber')
      const Promise = require('bluebird')
      let flag = true
      const order = []
      setParallelCanAssign(() => (flag = !flag))
      Given(/^step (\d+)$/, function(step, cb) {
        order.push(step)
        setTimeout(cb, 250)
        if (step === 1) throw Error(`#${step} this guy should be last`)
      })
      Then(/^log order$/, function() { console.log(order) })
      """
    And a file named "features/a.feature" with:
      """
      Feature: slow
        Scenario: a
          Given step 1
          Then log order

        Scenario: b
          Given step 2
          Then log order

        Scenario: c
          Given step 3
          Then log order
      """
    When I run cucumber-js with `--parallel 2`
    Then it fails
    And the output contains the text:
    """
    #1 this guy should be last
    """
