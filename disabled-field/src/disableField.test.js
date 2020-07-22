import hideField from './disableField'

const mockPluginFactory = () => ({
  startAutoResizer: jest.fn(() => null),
  toggleField: jest.fn(() => null),
})

describe('hideField', () => {
  afterEach(() => {
    document.getElementsByTagName('html')[0].innerHTML = ''
  })

  it('hides field', () => {
    const plugin = mockPluginFactory()
    hideField(plugin)
    expect(plugin.startAutoResizer).toHaveBeenCalledTimes(1)
    expect(plugin.toggleField).toHaveBeenCalledTimes(1)
  })
})
