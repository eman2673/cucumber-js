import _ from 'lodash'
import Formatter, { IFormatterOptions } from './'
import Status from '../status'
import { formatLocation, GherkinDocumentParser, PickleParser } from './helpers'
import { durationToNanoseconds } from '../time'
import path from 'path'
import { messages } from '@cucumber/messages'
import {
  getGherkinExampleRuleMap,
  getGherkinScenarioLocationMap,
} from './helpers/gherkin_document_parser'
import { ITestCaseAttempt } from './helpers/event_data_collector'
import { doesHaveValue, doesNotHaveValue } from '../value_checker'
import { parseStepArgument } from '../step_arguments'
import ITag = messages.GherkinDocument.Feature.ITag
import IFeature = messages.GherkinDocument.IFeature
import IPickle = messages.IPickle
import IScenario = messages.GherkinDocument.Feature.IScenario
import IPickleTag = messages.Pickle.IPickleTag
import IEnvelope = messages.IEnvelope
import IRule = messages.GherkinDocument.Feature.FeatureChild.IRule

const { getGherkinStepMap, getGherkinScenarioMap } = GherkinDocumentParser

const {
  getScenarioDescription,
  getPickleStepMap,
  getStepKeyword,
} = PickleParser

export interface IJsonFeature {
  description: string
  elements: IJsonScenario[]
  id: string
  keyword: string
  line: number
  name: string
  tags: IJsonTag[]
  uri: string
}

export interface IJsonScenario {
  description: string
  id: string
  keyword: string
  line: number
  name: string
  steps: IJsonStep[]
  tags: IJsonTag[]
  type: string
}

export interface IJsonStep {
  arguments?: any // TODO
  embeddings?: any // TODO
  hidden?: boolean
  keyword?: string // TODO, not optional
  line?: number
  match?: any // TODO
  name?: string
  result?: any // TODO
}

export interface IJsonTag {
  name: string
  line: number
}

interface IBuildJsonFeatureOptions {
  feature: messages.GherkinDocument.IFeature
  elements: IJsonScenario[]
  uri: string
}

interface IBuildJsonScenarioOptions {
  feature: messages.GherkinDocument.IFeature
  gherkinScenarioMap: Record<string, IScenario>
  gherkinExampleRuleMap: Record<string, IRule>
  gherkinScenarioLocationMap: Record<string, messages.ILocation>
  pickle: messages.IPickle
  steps: IJsonStep[]
}

interface IBuildJsonStepOptions {
  isBeforeHook: boolean
  gherkinStepMap: Record<string, messages.GherkinDocument.Feature.IStep>
  pickleStepMap: Record<string, messages.Pickle.IPickleStep>
  testStep: messages.TestCase.ITestStep
  testStepAttachments: messages.IAttachment[]
  testStepResult: messages.TestStepFinished.ITestStepResult
}

interface UriToTestCaseAttemptsMap {
  [uri: string]: ITestCaseAttempt[]
}

export default class JsonFormatter extends Formatter {
  constructor(options: IFormatterOptions) {
    super(options)
    options.eventBroadcaster.on('envelope', (envelope: IEnvelope) => {
      if (doesHaveValue(envelope.testRunFinished)) {
        this.onTestRunFinished()
      }
    })
  }

  convertNameToId(obj: IFeature | IPickle): string {
    return obj.name.replace(/ /g, '-').toLowerCase()
  }

  formatDataTable(dataTable: messages.PickleStepArgument.IPickleTable): any {
    return {
      rows: dataTable.rows.map((row) => ({ cells: _.map(row.cells, 'value') })),
    }
  }

  formatDocString(
    docString: messages.PickleStepArgument.IPickleDocString,
    gherkinStep: messages.GherkinDocument.Feature.IStep
  ): any {
    return {
      content: docString.content,
      line: gherkinStep.docString.location.line,
    }
  }

  formatStepArgument(
    stepArgument: messages.IPickleStepArgument,
    gherkinStep: messages.GherkinDocument.Feature.IStep
  ): any {
    if (doesNotHaveValue(stepArgument)) {
      return []
    }
    return [
      parseStepArgument<any>(stepArgument, {
        dataTable: (dataTable) => this.formatDataTable(dataTable),
        docString: (docString) => this.formatDocString(docString, gherkinStep),
      }),
    ]
  }

  onTestRunFinished(): void {
    const groupedTestCaseAttempts: UriToTestCaseAttemptsMap = {}
    _.each(
      this.eventDataCollector.getTestCaseAttempts(),
      (testCaseAttempt: ITestCaseAttempt) => {
        if (!testCaseAttempt.worstTestStepResult.willBeRetried) {
          const uri = path.relative(this.cwd, testCaseAttempt.pickle.uri)
          if (doesNotHaveValue(groupedTestCaseAttempts[uri])) {
            groupedTestCaseAttempts[uri] = []
          }
          groupedTestCaseAttempts[uri].push(testCaseAttempt)
        }
      }
    )
    const features = _.map(groupedTestCaseAttempts, (group, uri) => {
      const { gherkinDocument } = group[0]
      const gherkinStepMap = getGherkinStepMap(gherkinDocument)
      const gherkinScenarioMap = getGherkinScenarioMap(gherkinDocument)
      const gherkinExampleRuleMap = getGherkinExampleRuleMap(gherkinDocument)
      const gherkinScenarioLocationMap = getGherkinScenarioLocationMap(
        gherkinDocument
      )
      const elements = group.map((testCaseAttempt: ITestCaseAttempt) => {
        const { pickle } = testCaseAttempt
        const pickleStepMap = getPickleStepMap(pickle)
        let isBeforeHook = true
        const steps = testCaseAttempt.testCase.testSteps.map((testStep) => {
          isBeforeHook = isBeforeHook && testStep.pickleStepId === ''
          return this.getStepData({
            isBeforeHook,
            gherkinStepMap,
            pickleStepMap,
            testStep,
            testStepAttachments: testCaseAttempt.stepAttachments[testStep.id],
            testStepResult: testCaseAttempt.stepResults[testStep.id],
          })
        })
        return this.getScenarioData({
          feature: gherkinDocument.feature,
          gherkinScenarioLocationMap,
          gherkinExampleRuleMap,
          gherkinScenarioMap,
          pickle,
          steps,
        })
      })
      return this.getFeatureData({
        feature: gherkinDocument.feature,
        elements,
        uri,
      })
    })
    this.log(JSON.stringify(features, null, 2))
  }

  getFeatureData({
    feature,
    elements,
    uri,
  }: IBuildJsonFeatureOptions): IJsonFeature {
    return {
      description: feature.description,
      elements,
      id: this.convertNameToId(feature),
      line: feature.location.line,
      keyword: feature.keyword,
      name: feature.name,
      tags: this.getFeatureTags(feature),
      uri,
    }
  }

  getScenarioData({
    feature,
    gherkinScenarioLocationMap,
    gherkinExampleRuleMap,
    gherkinScenarioMap,
    pickle,
    steps,
  }: IBuildJsonScenarioOptions): IJsonScenario {
    const description = getScenarioDescription({
      pickle,
      gherkinScenarioMap,
    })
    return {
      description,
      id: this.formatScenarioId({ feature, pickle, gherkinExampleRuleMap }),
      keyword: gherkinScenarioMap[pickle.astNodeIds[0]].keyword,
      line: gherkinScenarioLocationMap[pickle.astNodeIds[0]].line,
      name: pickle.name,
      steps,
      tags: this.getScenarioTags({ feature, pickle, gherkinScenarioMap }),
      type: 'scenario',
    }
  }

  private formatScenarioId({
    feature,
    pickle,
    gherkinExampleRuleMap,
  }: {
    feature: IFeature
    pickle: IPickle
    gherkinExampleRuleMap: Record<string, IRule>
  }): string {
    let parts: any[]
    const rule = gherkinExampleRuleMap[pickle.astNodeIds[0]]
    if (doesHaveValue(rule)) {
      parts = [feature, rule, pickle]
    } else {
      parts = [feature, pickle]
    }
    return parts.map((part) => this.convertNameToId(part)).join(';')
  }

  getStepData({
    isBeforeHook,
    gherkinStepMap,
    pickleStepMap,
    testStep,
    testStepAttachments,
    testStepResult,
  }: IBuildJsonStepOptions): IJsonStep {
    const data: IJsonStep = {}
    if (testStep.pickleStepId !== '') {
      const pickleStep = pickleStepMap[testStep.pickleStepId]
      data.arguments = this.formatStepArgument(
        pickleStep.argument,
        gherkinStepMap[pickleStep.astNodeIds[0]]
      )
      data.keyword = getStepKeyword({ pickleStep, gherkinStepMap })
      data.line = gherkinStepMap[pickleStep.astNodeIds[0]].location.line
      data.name = pickleStep.text
    } else {
      data.keyword = isBeforeHook ? 'Before' : 'After'
      data.hidden = true
    }
    if (testStep.stepDefinitionIds.length === 1) {
      const stepDefinition = this.supportCodeLibrary.stepDefinitions.find(
        (s) => s.id === testStep.stepDefinitionIds[0]
      )
      data.match = { location: formatLocation(stepDefinition) }
    }
    const { message, status } = testStepResult
    data.result = { status: Status[status].toLowerCase() }
    if (doesHaveValue(testStepResult.duration)) {
      data.result.duration = durationToNanoseconds(testStepResult.duration)
    }
    if (status === Status.FAILED && doesHaveValue(message)) {
      data.result.error_message = message
    }
    if (_.size(testStepAttachments) > 0) {
      data.embeddings = testStepAttachments.map((attachment) => ({
        data: attachment.body,
        mime_type: attachment.mediaType,
      }))
    }
    return data
  }

  getFeatureTags(feature: IFeature): IJsonTag[] {
    return _.map(feature.tags, (tagData) => ({
      name: tagData.name,
      line: tagData.location.line,
    }))
  }

  getScenarioTags({
    feature,
    pickle,
    gherkinScenarioMap,
  }: {
    feature: IFeature
    pickle: IPickle
    gherkinScenarioMap: Record<string, IScenario>
  }): IJsonTag[] {
    const scenario = gherkinScenarioMap[pickle.astNodeIds[0]]

    return pickle.tags.map(
      (tagData: IPickleTag): IJsonTag =>
        this.getScenarioTag(tagData, feature, scenario)
    )
  }

  private getScenarioTag(
    tagData: IPickleTag,
    feature: IFeature,
    scenario: IScenario
  ): IJsonTag {
    const byAstNodeId = (tag: ITag): Boolean => tag.id === tagData.astNodeId
    const flatten = (acc: ITag[], val: ITag[]): ITag[] => acc.concat(val)

    const tag =
      feature.tags.find(byAstNodeId) ||
      scenario.tags.find(byAstNodeId) ||
      scenario.examples
        .map((e) => e.tags)
        .reduce(flatten, [])
        .find(byAstNodeId)

    return {
      name: tagData.name,
      line: tag?.location?.line,
    }
  }
}
